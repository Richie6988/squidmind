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
      // Cleanup partial file
      try { if (fs.existsSync(destPath + '.partial')) fs.unlinkSync(destPath + '.partial'); } catch {}
    });
    
    return state;
  }
  
  /**
   * Internal: actually perform the download with redirect handling.
   */
  async _doDownload(state) {
    state.status = 'downloading';
    
    if (!fs.existsSync(this.modelsDir)) {
      await fsp.mkdir(this.modelsDir, { recursive: true });
    }
    
    const partialPath = state.destPath + '.partial';
    
    return new Promise((resolve, reject) => {
      const followRedirect = (currentUrl, depth = 0) => {
        if (depth > 10) return reject(new Error('Too many redirects'));
        
        const lib = currentUrl.startsWith('https:') ? https : http;
        const req = lib.get(currentUrl, {
          headers: {
            'User-Agent': 'SquidMind/2.0',
            'Accept': '*/*'
          }
        }, (res) => {
          // Follow 3xx redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, currentUrl).toString();
            return followRedirect(next, depth + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
          }
          
          state.totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          const out = fs.createWriteStream(partialPath);
          
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
