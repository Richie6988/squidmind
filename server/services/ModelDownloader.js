/**
 * ModelDownloader - HuggingFace / direct URL downloads with progress tracking.
 * 
 * Uses native fetch (Node 18+) to stream large files to disk.
 * Tracks in-progress downloads so the UI can poll progress.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');

class ModelDownloader {
  constructor(modelsDir) {
    this.modelsDir = modelsDir;
    this.active = new Map(); // downloadId -> {url, fileName, bytesDownloaded, totalBytes, status, error, startedAt}
  }
  
  /**
   * Normalize a HuggingFace URL/repo identifier to a direct download URL.
   * Accepts:
   *  - Full URL: https://huggingface.co/.../resolve/main/file.gguf
   *  - Repo+file: TheBloke/Qwen-1_5B-GGUF/qwen-1_5b.Q4_K_M.gguf  
   *  - Any direct http(s):// URL
   */
  static normalizeUrl(input) {
    input = input.trim();
    
    // Already a full URL
    if (/^https?:\/\//.test(input)) {
      // Auto-fix HuggingFace "blob" URLs -> "resolve" URLs
      if (input.includes('huggingface.co') && input.includes('/blob/')) {
        return input.replace('/blob/', '/resolve/');
      }
      return input;
    }
    
    // HuggingFace repo+file shorthand: "org/repo/file.gguf"
    const parts = input.split('/').filter(Boolean);
    if (parts.length >= 3) {
      const org = parts[0];
      const repo = parts[1];
      const fileName = parts.slice(2).join('/');
      return `https://huggingface.co/${org}/${repo}/resolve/main/${fileName}`;
    }
    
    throw new Error(`Cannot parse: "${input}". Provide a full URL or org/repo/file.gguf`);
  }
  
  /**
   * Start a download. Returns immediately with downloadId.
   * Use getProgress(downloadId) to poll.
   */
  startDownload(rawUrl, suggestedFileName = null) {
    const url = ModelDownloader.normalizeUrl(rawUrl);
    
    // Figure out filename
    let fileName = suggestedFileName;
    if (!fileName) {
      const urlPath = new URL(url).pathname;
      fileName = decodeURIComponent(path.basename(urlPath)); // basename strips gguf/ subdir
    }
    // Strip any directory prefix that slipped through (e.g. "gguf/model.gguf" → "model.gguf")
    fileName = path.basename(fileName);
    if (!fileName.toLowerCase().endsWith('.gguf')) {
      throw new Error(`Refusing to download non-.gguf file: ${fileName}`);
    }
    
    const destPath = path.join(this.modelsDir, fileName);
    const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    
    const state = {
      downloadId,
      url, fileName, destPath,
      bytesDownloaded: 0,
      totalBytes: 0,
      percentage: 0,
      status: 'starting',
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null
    };
    this.active.set(downloadId, state);
    
    // Don't await - fire and forget; client polls progress
    this._doDownload(state).catch(err => {
      state.status = 'failed';
      state.error = err.message;
      state.completedAt = new Date().toISOString();
      // KEEP the .partial file — a retried download of the same file
      // resumes from it with a Range request instead of restarting a
      // multi-GB transfer from zero.
    });
    
    return state;
  }
  
  /**
   * Internal: actually perform the download with redirect handling.
   *
   * Transient failures retry up to 3 times, ALWAYS restarting the redirect
   * chain from the ORIGIN url (huggingface.co/resolve/...) — the cdn-lfs
   * URLs it redirects to are presigned with an Expires timestamp, so
   * retrying the CDN URL after a stall/interruption yields HTTP 403
   * (expired signature). A fresh chain gets a fresh signature.
   * Retries resume from the .partial file with a Range request.
   */
  async _doDownload(state) {
    state.status = 'downloading';

    if (!fs.existsSync(this.modelsDir)) {
      await fsp.mkdir(this.modelsDir, { recursive: true });
    }

    const MAX_ATTEMPTS = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this._attemptDownload(state);
        return; // success
      } catch (err) {
        lastErr = err;
        if (err.permanent || attempt === MAX_ATTEMPTS) throw err;
        state.status = 'retrying';
        state.error = `attempt ${attempt} failed (${err.message.split('\n')[0]}) — retrying with fresh URL…`;
        await new Promise(r => setTimeout(r, 1500 * attempt));
        state.status = 'downloading';
        state.error = null;
      }
    }
    throw lastErr;
  }

  /** One full redirect-chain + stream attempt, resuming from .partial if present. */
  _attemptDownload(state) {
    const partialPath = state.destPath + '.partial';
    
    return new Promise((resolve, reject) => {
      // Resume support: request the remainder of an existing .partial.
      let resumeFrom = 0;
      try { if (fs.existsSync(partialPath)) resumeFrom = fs.statSync(partialPath).size; } catch {}

      const followRedirect = (currentUrl, depth = 0) => {
        if (depth > 10) return reject(new Error('Too many redirects'));
        
        const lib = currentUrl.startsWith('https:') ? https : http;
        // Gated Hugging Face models return 401 without a bearer token.
        // Read HF_TOKEN (aka HUGGING_FACE_HUB_TOKEN) from env; propagate it
        // only to huggingface.co and cdn-lfs.huggingface.co so we don't
        // leak the token when the URL redirects to a signed S3 URL that
        // already carries its own credentials in the query string.
        const isHfHost = /(^|\.)huggingface\.co$/i.test(new URL(currentUrl).hostname);
        const hfToken  = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || '';
        const headers  = {
          'User-Agent': 'SquidMind/2.0',
          'Accept':     '*/*',
        };
        if (isHfHost && hfToken) headers['Authorization'] = `Bearer ${hfToken}`;
        if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

        const req = lib.get(currentUrl, { headers }, (res) => {
          // Follow 3xx redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, currentUrl).toString();
            return followRedirect(next, depth + 1);
          }
          if (res.statusCode === 401 || res.statusCode === 403) {
            res.resume();
            // 403 from a presigned CDN URL (has Expires/Signature in the
            // query, host is NOT huggingface.co) = expired signature →
            // TRANSIENT: the retry ladder restarts from the origin URL
            // and gets a fresh signature. 401/403 from hf.co itself is a
            // real auth problem → permanent.
            const u = new URL(currentUrl);
            const isSignedCdn = !/(^|\.)huggingface\.co$/i.test(u.hostname) &&
              /(^|&)(Expires|X-Amz-Expires|Policy|Signature)=/i.test(u.search.slice(1));
            if (res.statusCode === 403 && isSignedCdn) {
              return reject(new Error(`HTTP 403 (expired signed URL) from ${u.hostname}`));
            }
            const isGated = res.statusCode === 401;
            const permErr = new Error(
              `HTTP ${res.statusCode} from ${currentUrl}\n` +
              (isGated
                ? 'This model is GATED. Accept its license on huggingface.co, ' +
                  'then set HF_TOKEN=hf_… in your .env (get one at ' +
                  'https://huggingface.co/settings/tokens) and retry.'
                : 'Access forbidden. Check that your HF_TOKEN has "read" ' +
                  'scope and that you have accepted the model license.')
            );
            permErr.permanent = true;
            return reject(permErr);
          }
          // 416 = our .partial is stale relative to the remote file (or
          // already complete) — drop it and let the retry start clean.
          if (res.statusCode === 416) {
            res.resume();
            try { fs.unlinkSync(partialPath); } catch {}
            return reject(new Error('HTTP 416 — stale .partial discarded, retrying from zero'));
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            const err = new Error(`HTTP ${res.statusCode} from ${currentUrl}`);
            if (res.statusCode >= 400 && res.statusCode < 500) err.permanent = true;
            return reject(err);
          }

          // 206 = server honored the Range → append. 200 despite a Range
          // request = server ignored it → restart the file from zero.
          const resuming = res.statusCode === 206 && resumeFrom > 0;
          const bodyBytes = parseInt(res.headers['content-length'] || '0', 10);
          state.totalBytes = resuming ? resumeFrom + bodyBytes : bodyBytes;
          state.bytesDownloaded = resuming ? resumeFrom : 0;
          const out = fs.createWriteStream(partialPath, resuming ? { flags: 'a' } : {});
          
          res.on('data', (chunk) => {
            state.bytesDownloaded += chunk.length;
            if (state.totalBytes > 0) {
              state.percentage = Math.round((state.bytesDownloaded / state.totalBytes) * 1000) / 10;
            }
          });
          
          res.pipe(out);
          out.on('finish', () => {
            out.close(async (err) => {
              if (err) return reject(err);
              try {
                await fsp.rename(partialPath, state.destPath);
                state.status = 'completed';
                state.percentage = 100;
                state.completedAt = new Date().toISOString();
                resolve();
              } catch (renameErr) {
                reject(renameErr);
              }
            });
          });
          out.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(60000, () => req.destroy(new Error('Connection timeout')));
      };
      
      followRedirect(state.url);
    });
  }

  /** Remove finished (completed/failed/cancelled) entries from the list. */
  clearFinished() {
    let cleared = 0;
    for (const [id, s] of this.active.entries()) {
      if (['completed', 'failed', 'cancelled'].includes(s.status)) {
        this.active.delete(id);
        cleared++;
      }
    }
    return cleared;
  }
  
  getProgress(downloadId) {
    return this.active.get(downloadId) || null;
  }
  
  listAll() {
    return Array.from(this.active.values()).slice(-20); // last 20
  }
  
  cancel(downloadId) {
    const state = this.active.get(downloadId);
    if (!state) return false;
    if (state.status === 'downloading' || state.status === 'starting') {
      state.status = 'cancelled';
      try {
        const partial = state.destPath + '.partial';
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
      } catch {}
      return true;
    }
    return false;
  }
}

module.exports = ModelDownloader;
