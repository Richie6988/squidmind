/**
 * OrchestratorTools
 *
 * External tool implementations called by PoseidonOrchestrator handlers.
 * Kept separate so the orchestrator file stays focused on the model-facing
 * function definitions and high-level handler logic.
 *
 * Implements:
 *   - web_search (DuckDuckGo HTML API, no key required)
 *   - web_fetch (any URL, returns text)
 *   - edit_file (find/replace inside an existing file)
 *   - git operations (single `git` action-dispatch tool: status/diff/commit/push)
 *   - image generation dispatch + upscale
 *
 * Every tool returns { ok: true, ... } on success or { ok: false, error } on
 * failure. Never throws to the caller - the LLM should see structured results
 * it can reason about.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const log = require('../utils/logger').createLogger('OrchestratorTools');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { fetchWithRetry } = require('../utils/fetchWithRetry');
const execAsync = promisify(exec);

class OrchestratorTools {
  constructor({ workspaceRoot, registryManager, githubToken, modelService }) {
    this.workspaceRoot = workspaceRoot;
    this.rm = registryManager;
    this.githubToken = githubToken || process.env.GITHUB_TOKEN || null;
    this.modelService = modelService || null;
  }

  // ====================================================================
  // WEB
  // ====================================================================

  /**
   * Web search. Tries DuckDuckGo first, falls back to public SearXNG instances.
   * Returns top results with title, url, snippet.
   */
  /**
   * searchImage — returns DIRECT image URLs (not result-page URLs).
   * Uses DuckDuckGo's i.js image endpoint, which needs a one-time `vqd`
   * token scraped from the HTML search page first. Returns entries with
   * a direct `image` URL, a `thumbnail`, source page, and dimensions —
   * ready to embed as markdown or feed to fetch_image_url.
   */
  async searchImage({ query, num_results = 6 }) {
    if (!query || typeof query !== 'string') {
      return { ok: false, error: 'query is required' };
    }
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    try {
      // Step 1: get the vqd token from the HTML endpoint
      const tokRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000),
      });
      const tokHtml = await tokRes.text();
      const vqd = (tokHtml.match(/vqd=["']?([\d-]+)["']?/) || tokHtml.match(/vqd=([^&"']+)/) || [])[1];
      if (!vqd) {
        return { ok: false, error: 'Could not obtain DuckDuckGo image token (vqd). Image search unavailable right now.' };
      }
      // Step 2: hit the i.js image JSON endpoint with the token
      const imgRes = await fetch(
        `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`,
        {
          headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
            'Referer': 'https://duckduckgo.com/',
          },
          signal: AbortSignal.timeout(12000),
        }
      );
      if (!imgRes.ok) return { ok: false, error: `Image endpoint HTTP ${imgRes.status}` };
      const json = await imgRes.json();
      const results = (json.results || []).slice(0, Math.min(num_results, 12)).map(r => ({
        title:     r.title || '',
        image:     r.image,          // direct image URL
        thumbnail: r.thumbnail,
        source:    r.url,            // source page
        width:     r.width,
        height:    r.height,
      })).filter(r => r.image);
      if (!results.length) return { ok: false, error: 'No images found for that query.' };
      return {
        ok: true,
        count: results.length,
        results,
        // First result as a ready-to-embed markdown convenience
        markdown: `![${(results[0].title || query).replace(/[[\]]/g, '')}](${results[0].image})`,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * fetchUrl — read a web page's CONTENT (search gives snippets; this gives
   * the substance). HTML is stripped to readable text, capped for small-model
   * contexts, with a truncation notice. SSRF-guarded: private/loopback hosts
   * are refused unless ALLOW_PRIVATE_FETCH=1.
   */
  async fetchUrl({ url, max_chars = 18_000 }) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'A full http(s) URL is required.' };
    }
    try {
      const u = new URL(url);
      const host = u.hostname;
      const isPrivate = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(host)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
      if (isPrivate && process.env.ALLOW_PRIVATE_FETCH !== '1') {
        return { ok: false, error: `Refusing to fetch private/loopback host "${host}" (set ALLOW_PRIVATE_FETCH=1 to allow).` };
      }

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} for ${url}` };

      const ctype = res.headers.get('content-type') || '';
      // Hard size cap on the raw body (2MB) before we even parse
      const raw = await res.text();
      const body = raw.length > 2_000_000 ? raw.slice(0, 2_000_000) : raw;

      let title = '';
      let text = body;
      if (/html/i.test(ctype) || /^\s*</.test(body)) {
        title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';
        text = body
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/[ \t]+/g, ' ')
          .replace(/\n\s*\n\s*\n+/g, '\n\n')
          .trim();
      }

      const cap = Math.min(Math.max(2_000, Number(max_chars) || 18_000), 40_000);
      const truncated = text.length > cap;
      if (truncated) {
        text = text.slice(0, cap) +
          `\n\n[... TRUNCATED: page is ${text.length} chars. Re-call fetch_url with a larger max_chars for more, or target a more specific URL. ...]`;
      }
      return { ok: true, url, title, content_type: ctype.split(';')[0], chars: text.length, truncated, text };
    } catch (e) {
      return { ok: false, error: `fetch failed: ${e.message}` };
    }
  }

  async webSearch({ query, num_results = 5 }) {
    if (!query || typeof query !== 'string') {
      return { ok: false, error: 'query is required' };
    }
    
    // Try DDG first (lite then html), then SearXNG fallbacks
    const sources = [
      { type: 'ddg', url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}` },
      { type: 'ddg', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` },
      { type: 'searxng', url: `https://search.brave4u.com/search?q=${encodeURIComponent(query)}&format=json` },
      { type: 'searxng', url: `https://searx.be/search?q=${encodeURIComponent(query)}&format=json` },
      { type: 'searxng', url: `https://search.disroot.org/search?q=${encodeURIComponent(query)}&format=json` }
    ];
    
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    ];
    
    let lastError = null;
    for (const source of sources) {
      for (const ua of userAgents) {
        try {
          const res = await fetch(source.url, {
            headers: {
              'User-Agent': ua,
              'Accept': source.type === 'searxng' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'DNT': '1',
              'Connection': 'keep-alive'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(12000)
          });
          if (!res.ok) {
            lastError = `${source.url}: HTTP ${res.status}`;
            continue;
          }
          
          if (source.type === 'searxng') {
            const json = await res.json();
            const results = (json.results || []).slice(0, num_results).map(r => ({
              title: r.title || '',
              url: r.url || '',
              snippet: r.content || ''
            })).filter(r => r.url && r.title);
            if (results.length > 0) {
              return { ok: true, count: results.length, results, source: source.url };
            }
          } else {
            const html = await res.text();
            const results = this._parseDdgResults(html, num_results);
            if (results.length > 0) {
              return { ok: true, count: results.length, results, source: source.url };
            }
          }
          lastError = `${source.url}: 0 results parsed`;
        } catch (err) {
          lastError = `${source.url}: ${err.message}`;
          // For searxng, don't loop UAs (json endpoint - UA doesn't help)
          if (source.type === 'searxng') break;
        }
      }
    }
    
    return {
      ok: false,
      error: `All search sources failed. Last error: ${lastError}. Search engines may be rate-limiting; try again shortly or use web_fetch on a specific URL.`
    };
  }
  
  _parseDdgResults(html, max) {
    const decode = (s) => s
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    
    const unwrap = (rawUrl) => {
      try {
        if (rawUrl.startsWith('//duckduckgo.com/l/') || rawUrl.startsWith('/l/')) {
          const params = new URLSearchParams(rawUrl.slice(rawUrl.indexOf('?') + 1));
          return params.get('uddg') || rawUrl;
        }
        if (rawUrl.startsWith('//')) return 'https:' + rawUrl;
        return rawUrl;
      } catch { return rawUrl; }
    };
    
    const results = [];
    
    // Strategy 1: lite.duckduckgo.com format - <a class="result-link" href="URL">title</a>
    // followed by <td class="result-snippet">snippet</td>
    const liteRe = /<a[^>]*(?:class="result-link"|rel="nofollow")[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const liteMatches = [...html.matchAll(liteRe)];
    if (liteMatches.length > 0) {
      const snippetRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
      const snippets = [...html.matchAll(snippetRe)];
      for (let i = 0; i < liteMatches.length && results.length < max; i++) {
        const url = unwrap(liteMatches[i][1]);
        const title = decode(liteMatches[i][2]);
        const snippet = snippets[i] ? decode(snippets[i][1]) : '';
        if (url && !url.includes('duckduckgo.com') && title) {
          results.push({ title, url, snippet });
        }
      }
      if (results.length > 0) return results;
    }
    
    // Strategy 2: html.duckduckgo.com format - <a class="result__a" href="URL">
    const htmlRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const htmlMatches = [...html.matchAll(htmlRe)];
    if (htmlMatches.length > 0) {
      const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const snippets = [...html.matchAll(snippetRe)];
      for (let i = 0; i < htmlMatches.length && results.length < max; i++) {
        const url = unwrap(htmlMatches[i][1]);
        const title = decode(htmlMatches[i][2]);
        const snippet = snippets[i] ? decode(snippets[i][1]) : '';
        if (url && title) {
          results.push({ title, url, snippet });
        }
      }
    }
    
    return results;
  }

  /**
   * Fetch a URL and return its text content. Truncates very large responses.
   */
  async webFetch({ url }) {
    if (!url || !/^https?:\/\//.test(url)) {
      return { ok: false, error: 'url must be http(s)://...' };
    }
    try {
      const res = await fetchWithRetry(url, {
        retries: 2, baseDelayMs: 500, timeoutMs: 30_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) SquidMind/1.0' },
        redirect: 'follow',
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      const MAX = 16000;
      
      // For HTML, strip tags to give the model usable text
      let cleaned = text;
      if (contentType.includes('html') || text.trimStart().startsWith('<')) {
        cleaned = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
      }
      
      const truncated = cleaned.length > MAX;
      return {
        ok: true,
        url,
        content_type: contentType,
        char_count: cleaned.length,
        content: truncated ? cleaned.slice(0, MAX) + `\n\n... (truncated from ${cleaned.length} chars)` : cleaned,
        truncated
      };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  }

  // ====================================================================
  // CODE EDITOR
  // ====================================================================

  _resolveInWorkspace(relPath) {
    const AQUARIUM = require('../aquarium');
    // Aquarium-aware: PROJECTS/*, TASKS/*, BRAIN/*, etc. → resolve from AQUARIUM.ROOT
    const upper = relPath.toUpperCase();
    let fullPath;
    if (/^(PROJECTS|TASKS|MODELS|AGENTS|SKILLS|BRAIN|LOGS|CHANNELS)(\/|$)/.test(upper)) {
      fullPath = path.join(AQUARIUM.ROOT, relPath);
    } else {
      fullPath = path.resolve(this.workspaceRoot, relPath);
    }
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error(`Path "${relPath}" escapes the workspace`);
    }
    return fullPath;
  }

  /**
   * Find/replace inside an existing file. search_text must appear EXACTLY ONCE
   * (so the LLM is forced to include enough surrounding context to be specific).
   */
  async editFile({ path: relPath, search_text, replace_text }) {
    if (!relPath || !search_text || replace_text === undefined) {
      return { ok: false, error: 'path, search_text, replace_text all required' };
    }
    try {
      const fullPath = this._resolveInWorkspace(relPath);
      const before = await fs.readFile(fullPath, 'utf8');
      
      const occurrences = before.split(search_text).length - 1;
      if (occurrences === 0) {
        return {
          ok: false,
          error: `search_text not found in ${relPath}. Try read_file first to see the exact current content.`
        };
      }
      if (occurrences > 1) {
        return {
          ok: false,
          error: `search_text appears ${occurrences} times in ${relPath} - it must appear exactly once. Include more surrounding lines to make it unique.`
        };
      }
      
      const after = before.replace(search_text, replace_text);
      // VERSIONING: same shadow-copy mechanism as write_file — an edit that
      // breaks a working file is reversible from the temple.
      try {
        const AQUARIUM = require('../aquarium');
        const pm = fullPath.match(new RegExp(`^(${AQUARIUM.PROJECTS.replace(/[/\\]/g, '[/\\\\]')}[/\\\\][^/\\\\]+)[/\\\\](.+)$`));
        if (pm) await require('./FileVersions').snapshot(pm[1], pm[2], { actor: 'agent' });
      } catch {}
      await fs.writeFile(fullPath, after, 'utf8');
      
      // Log it
      if (this.rm) {
        await this.rm.log({
          event_type: 'file_modified',
          severity: 'info',
          actor: { type: 'system', id: 'poseidon_main' },
          subject: { type: 'file', id: relPath },
          action: `Poseidon edited ${relPath}`,
          context: {
            search_preview: search_text.slice(0, 80),
            replace_preview: replace_text.slice(0, 80),
            chars_before: before.length,
            chars_after: after.length
          }
        }).catch(() => {});
      }
      
      return {
        ok: true,
        path: relPath,
        chars_changed: Math.abs(after.length - before.length),
        message: `Edited ${relPath} (${before.length} → ${after.length} chars)`
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ====================================================================
  // GITHUB (local git via child_process)
  // ====================================================================

  async _git(cmd, opts = {}) {
    try {
      const { stdout, stderr } = await execAsync(`git ${cmd}`, {
        cwd: this.workspaceRoot,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        ...opts
      });
      return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
      return {
        ok: false,
        error: err.message,
        stderr: err.stderr?.trim() || '',
        stdout: err.stdout?.trim() || ''
      };
    }
  }

  async githubStatus() {
    const branch = await this._git('rev-parse --abbrev-ref HEAD');
    const status = await this._git('status --porcelain=v1 -b');
    if (!status.ok) return status;
    
    const lines = status.stdout.split('\n').filter(Boolean);
    const branchLine = lines.find(l => l.startsWith('##')) || '';
    
    // Parse: ## main...origin/main [ahead 2, behind 1]
    let ahead = 0, behind = 0, remoteBranch = null;
    const aheadMatch = branchLine.match(/ahead (\d+)/);
    const behindMatch = branchLine.match(/behind (\d+)/);
    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
    if (behindMatch) behind = parseInt(behindMatch[1], 10);
    const remoteMatch = branchLine.match(/\.\.\.([^\s\]]+)/);
    if (remoteMatch) remoteBranch = remoteMatch[1];
    
    const files = lines.filter(l => !l.startsWith('##')).map(l => {
      const status = l.slice(0, 2).trim();
      const file = l.slice(3);
      let label = 'modified';
      if (status === '??') label = 'untracked';
      else if (status.startsWith('A')) label = 'added';
      else if (status.startsWith('D')) label = 'deleted';
      else if (status.startsWith('R')) label = 'renamed';
      else if (status === 'M' || status === ' M' || status === 'M ') label = 'modified';
      return { file, status: label, raw_code: status };
    });
    
    return {
      ok: true,
      branch: branch.stdout,
      remote: remoteBranch,
      ahead, behind,
      clean: files.length === 0,
      modified_count: files.length,
      files
    };
  }

  async githubDiff({ path: filePath } = {}) {
    const cmd = filePath ? `diff -- ${JSON.stringify(filePath)}` : 'diff';
    const r = await this._git(cmd);
    if (!r.ok) return r;
    // Also include staged changes
    const staged = await this._git(filePath ? `diff --staged -- ${JSON.stringify(filePath)}` : 'diff --staged');
    
    const diffText = (r.stdout || '') + (staged.stdout ? '\n=== STAGED ===\n' + staged.stdout : '');
    const MAX = 8000;
    return {
      ok: true,
      path: filePath || '(whole repo)',
      diff: diffText.length > MAX ? diffText.slice(0, MAX) + `\n\n... (truncated from ${diffText.length} chars)` : diffText,
      truncated: diffText.length > MAX,
      char_count: diffText.length
    };
  }

  async githubCommit({ message, files }) {
    if (!message) return { ok: false, error: 'commit message required' };
    
    // Stage files (specific paths or everything)
    let stageRes;
    if (files && Array.isArray(files) && files.length > 0) {
      const fileArgs = files.map(f => JSON.stringify(f)).join(' ');
      stageRes = await this._git(`add -- ${fileArgs}`);
    } else {
      stageRes = await this._git('add -A');
    }
    if (!stageRes.ok) return { ok: false, error: 'staging failed: ' + (stageRes.stderr || stageRes.error) };
    
    // Check if anything actually got staged
    const diff = await this._git('diff --cached --stat');
    if (!diff.stdout) {
      return { ok: false, error: 'nothing to commit (no staged changes)' };
    }
    
    // Commit
    const escMsg = message.replace(/"/g, '\\"');
    const commitRes = await this._git(`commit -m "${escMsg}"`);
    if (!commitRes.ok) return { ok: false, error: commitRes.stderr || commitRes.error };
    
    // Get the new commit hash
    const hash = await this._git('rev-parse --short HEAD');
    
    if (this.rm) {
      await this.rm.log({
        event_type: 'github_commit',
        severity: 'info',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'system', id: 'git' },
        action: `Poseidon committed: ${message}`,
        context: { hash: hash.stdout, files_staged: diff.stdout }
      }).catch(() => {});
    }
    
    return {
      ok: true,
      hash: hash.stdout,
      message,
      staged_stats: diff.stdout,
      output: commitRes.stdout
    };
  }

  async githubPush({ remote = 'origin', branch } = {}) {
    let branchName = branch;
    if (!branchName) {
      const b = await this._git('rev-parse --abbrev-ref HEAD');
      if (!b.ok) return b;
      branchName = b.stdout;
    }
    const res = await this._git(`push ${remote} ${branchName}`);
    if (!res.ok) {
      // Common case: branch doesn't exist on remote, suggest --set-upstream
      const hint = /no upstream|set-upstream/i.test(res.stderr) ?
        ` (hint: this branch has no upstream; try git push --set-upstream ${remote} ${branchName})` : '';
      return { ok: false, error: (res.stderr || res.error) + hint };
    }
    
    if (this.rm) {
      await this.rm.log({
        event_type: 'github_push',
        severity: 'info',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'system', id: 'git' },
        action: `Poseidon pushed ${branchName} to ${remote}`
      }).catch(() => {});
    }
    
    return { ok: true, remote, branch: branchName, output: res.stdout + '\n' + res.stderr };
  }

  async githubPull({ remote = 'origin', branch } = {}) {
    let branchName = branch;
    if (!branchName) {
      const b = await this._git('rev-parse --abbrev-ref HEAD');
      if (!b.ok) return b;
      branchName = b.stdout;
    }
    const res = await this._git(`pull ${remote} ${branchName}`);
    if (!res.ok) return { ok: false, error: res.stderr || res.error };
    return { ok: true, remote, branch: branchName, output: res.stdout };
  }

  // ====================================================================
  // IMAGE GENERATION
  // ====================================================================

  /**
   * Generate an image using an assigned image-type GGUF model.
   * Saves the result to the project outputs folder and returns a URL.
   */
  async generateImage({ model_id, prompt, project_id, filename, width, height, steps, cfg_scale, seed, negative_prompt, upscale, source_image, strength }) {
    try {
      if (!model_id) return { ok: false, error: 'model_id is required' };
      if (!prompt)   return { ok: false, error: 'prompt is required' };

      const _aq = require('../aquarium');
      const fs2 = require('fs').promises;
      const safeFilename = (filename || `generated_${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');

      // Create a task to track progress in the right panel
      let taskId = null;
      let taskObj = null;
      try {
        taskObj = await this.rm.createTask({
          title: `Image: ${prompt.slice(0, 55)}`,
          description: `Model: ${model_id}\nPrompt: ${prompt}\nSize: ${width||512}x${height||512}`,
          task_type: 'image_generation',
          project_id: project_id || null,
        });
        taskId = taskObj?.task_id || null;
        // Write in_progress status through the flat registry path
        if (taskId && taskObj) {
          taskObj.status = 'in_progress';
          taskObj.lifecycle = {
            ...(taskObj.lifecycle || {}),
            status: 'in_progress',
            started_at: new Date().toISOString()
          };
          await this.rm._writeTaskDetails(taskId, taskObj);
          this.rm.invalidateCache();
          log.info('task created:', taskId, '— status: in_progress');
        }
      } catch(e) { log.warn('task creation failed:', e.message); }

      // Route output:
      //   With project: PROJECTS/<folder>/output/<safeFilename>
      //   Without:      TASKS/OUTPUT/<task_id>.png   (no per-task folder)
      const AQUARIUM = require('../aquarium');
      let outputDir, outFilename, serveBase;
      if (project_id) {
        try {
          const reg = await this.rm.read('PROJECTS/project_registry.json').catch(() => ({ projects: {} }));
          const proj = reg.projects?.[project_id];
          const folder = proj?.folder || project_id;
          outputDir   = require('path').join(AQUARIUM.PROJECTS, folder, 'output');
          outFilename = safeFilename;
          serveBase   = require('path').join(outputDir, outFilename);
        } catch {}
      }
      if (!outputDir) {
        // Flat layout: every task-scoped image lands in TASKS/OUTPUT/<task_id>.png
        // (or generated_<ts>.png as fallback when no task could be created).
        outputDir   = AQUARIUM.OUTPUT;
        outFilename = taskId ? `${taskId}.png` : (safeFilename || `generated_${Date.now()}.png`);
        serveBase   = require('path').join(outputDir, outFilename);
      }
      await fs2.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, outFilename);

      if (!this.modelService) return { ok: false, error: 'modelService not available' };

      const result = await this.modelService.generateImage({
        modelId: model_id, prompt, outputPath,
        width: width || 900, height: height || 900,
        steps: steps || 20, cfg: cfg_scale || 7,
        seed: seed ?? -1, negativePrompt: negative_prompt || '',
        user_initiated: true,   // chat tool + UI route both land here — the human asked
        initImage: source_image || null,
        strength: strength != null ? strength : 0.75,
      });

      // Second-wave upscale (mirrors the img task-runner path). Runs img2img
      // with the wave-1 output as init-img at N× the dims, strength=0.35 so
      // details refine without redesign. Silently no-op if wave 1 failed.
      if (result?.ok && result.outputPath && Number(upscale) >= 2) {
        const scale = Number(upscale);
        const upscaledPath = result.outputPath.replace(/\.(png|jpe?g)$/i, `_x${scale}.$1`);
        try {
          log.info(`upscale pass x${scale} on ${outFilename}`);
          const up = await this.modelService.generateImage({
            modelId:        model_id,
            prompt,
            negativePrompt: negative_prompt || '',
            outputPath:     upscaledPath,
            width:          (width  || 900) * scale,
            height:         (height || 900) * scale,
            steps:          Math.min(steps || 20, 6),
            cfg:            cfg_scale || 7,
            seed:           seed ?? -1,
            initImage:      result.outputPath,
            strength:       0.35,
          });
          if (up?.ok && up.outputPath) {
            // Point serveBase at the upscaled version — that's what users want to see
            result.outputPath = up.outputPath;
            serveBase = require('path').join(outputDir, require('path').basename(up.outputPath));
          } else {
            log.warn(`upscale pass x${scale} failed:`, up?.error || 'unknown');
          }
        } catch (e) { log.warn(`upscale pass error:`, e.message); }
      }

      // serveUrl computed AFTER upscale so it reflects the upscaled file when
      // present. Previously this was a const set before the upscale block, so
      // the returned URL + markdown always pointed at the low-res wave-1 image
      // and the upscale was invisible even though it was generated on disk.
      const serveUrl = `/api/files/read?path=${encodeURIComponent(serveBase)}`;

      // Update task status + persist a results_log entry so the Results panel
      // (/api/v2/tasks/results) actually sees the completed image. The earlier
      // code only set output_preview and bypassed results_log entirely, so
      // image results never surfaced in the UI.
      if (taskId && taskObj) {
        try {
          const finalStatus = result.ok ? 'completed' : 'failed';
          const completedAt = new Date().toISOString();
          taskObj.status = finalStatus;
          taskObj.lifecycle = {
            ...(taskObj.lifecycle || {}),
            status: finalStatus,
            completed_at: completedAt
          };
          if (result.ok) {
            taskObj.output_preview = serveUrl;
            taskObj.result_file    = serveBase;       // canonical disk path
            taskObj.result_summary = `Image: ${prompt.slice(0, 80)}`;
          } else {
            taskObj.result_summary = `Failed: ${result.error || 'unknown'}`;
          }
          taskObj.completed_at = completedAt;
          await this.rm._writeTaskDetails(taskId, taskObj);
          this.rm.invalidateCache();

          // Write to results_log.json so /api/v2/tasks/results returns it.
          // Use the same shape TaskRunner.setStatus would have written.
          try {
            const fsp = require('fs').promises;
            let rlog = { results: {} };
            try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
            rlog.results[taskId] = {
              task_id:        taskId,
              title:          taskObj.title,
              task_type:      'image_generation',
              status:         finalStatus,
              result_summary: taskObj.result_summary,
              result_file:    taskObj.result_file || null,
              output_preview: taskObj.output_preview || null,
              completed_at:   completedAt,
              assigned_name:  taskObj.assigned_to || null,
              project_name:   taskObj.project_name || taskObj.context?.project_name || null,
              project_id:     taskObj.project_id   || taskObj.context?.project_id   || null,
            };
            await fsp.writeFile(AQUARIUM.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');
          } catch (re) { log.warn(`results_log write failed for ${taskId}:`, re.message); }

          // Broadcast lifecycle event so the UI refreshes without polling lag.
          try {
            global.ReasoningBus?.push({
              type:           'task_lifecycle',
              task_id:        taskId,
              status:         finalStatus,
              title:          taskObj.title,
              result_file:    taskObj.result_file || null,
              result_summary: taskObj.result_summary,
              timestamp:      Date.now(),
            });
          } catch {}
        } catch(e) { log.warn('task status update failed:', e.message); }
      }

      if (!result.ok) return result;
      return { ok: true, url: serveUrl, outputPath: result.outputPath, bytes: result.bytes,
               filename: outFilename, task_id: taskId,
               markdown: `![${prompt.slice(0,40)}](${serveUrl})` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  /**
   * Fetch a URL and save the extracted text content to a file.
   * output_path is relative to the project output or task folder.
   */
  async fetchAndSave({ url, output_path, task_id, project_id }) {
    if (!url || !/^https?:\/\//.test(url)) {
      return { ok: false, error: 'url must start with http(s)://' };
    }
    try {
      // Fetch UNTRUNCATED: the on-disk file must hold the full page. The
      // default webFetch caps at 16k for context safety — that cap belongs
      // in the model's context, not on disk. We ask for the full body here.
      const fetchResult = await this.webFetch({ url, max_chars: 5_000_000 });
      if (!fetchResult.ok) return fetchResult;

      const content = fetchResult.content;

      // Resolve output path — and force .md over .txt so previews stay
      // readable (Richard's rule: .txt files were shown truncated in the UI
      // preview even when the file itself was fine).
      const AQUARIUM = require('../aquarium');
      const path = require('path');
      const fs   = require('fs').promises;
      const _mdify = (p) => (typeof p === 'string' && p.toLowerCase().endsWith('.txt')) ? p.slice(0, -4) + '.md' : p;
      output_path = _mdify(output_path);
      let savePath;

      if (output_path && path.isAbsolute(output_path)) {
        savePath = output_path;
      } else if (project_id) {
        try {
          const reg  = await this.rm.read('PROJECTS/project_registry.json').catch(() => ({ projects: {} }));
          const proj = reg.projects?.[project_id];
          const folder = proj?.folder || project_id;
          // ROUTING RULE — raw web fetches are drafts, not deliverables.
          // They land in <project>/temp/ by default. The agent has to
          // deliberately write_file() into output/ to produce the FINAL
          // artifact — that gates 'is this actually a deliverable?' at
          // the write step. Honors an explicit 'output/' prefix if the
          // caller genuinely wants the raw fetch in output/.
          const explicitOutput = /^(?:output|OUTPUT)\//.test(output_path || '');
          const targetDir = explicitOutput ? 'output' : 'temp';
          const outDir = path.join(AQUARIUM.PROJECTS, folder, targetDir);
          await fs.mkdir(outDir, { recursive: true });
          const fname = (output_path || `fetch_${Date.now()}.md`).replace(/^(?:output|OUTPUT|temp|TEMP)\//, '');
          savePath = path.join(outDir, path.basename(fname));
        } catch {
          // Last-resort fallback — flat TASKS/OUTPUT/, no per-task folder.
          await fs.mkdir(AQUARIUM.OUTPUT, { recursive: true });
          const raw = output_path || 'fetch.md';
          const ext = raw.split('.').pop().toLowerCase();
          savePath = path.join(AQUARIUM.OUTPUT, `${task_id || 'tmp_' + Date.now()}.${ext === 'txt' ? 'md' : ext}`);
        }
      } else if (task_id) {
        // Flat layout — single file in TASKS/OUTPUT named after the task ID.
        // No per-task folder. Multiple fetches under the same task overwrite.
        await fs.mkdir(AQUARIUM.OUTPUT, { recursive: true });
        const raw = output_path || 'fetch.md';
        const ext = raw.split('.').pop().toLowerCase();
        savePath = path.join(AQUARIUM.OUTPUT, `${task_id}.${ext === 'txt' ? 'md' : ext}`);
      } else {
        return { ok: false, error: 'Provide task_id or project_id so the file has a destination' };
      }

      await fs.mkdir(path.dirname(savePath), { recursive: true });
      await fs.writeFile(savePath, content, 'utf8');

      return {
        ok: true,
        url,
        saved_to: savePath,
        char_count: content.length,
        summary: content.slice(0, 300)
      };
    } catch (err) {
      return { ok: false, error: err.message, url };
    }
  }
}

module.exports = OrchestratorTools;
