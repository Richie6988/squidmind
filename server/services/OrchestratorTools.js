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
 *   - github_status / github_diff / github_commit / github_push / github_pull
 *
 * Every tool returns { ok: true, ... } on success or { ok: false, error } on
 * failure. Never throws to the caller - the LLM should see structured results
 * it can reason about.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
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
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) SquidMind/1.0' },
        redirect: 'follow',
        // 30s timeout via AbortController
        signal: AbortSignal.timeout(30000)
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
    const fullPath = path.resolve(this.workspaceRoot, relPath);
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
  async generateImage({ model_id, prompt, project_id, filename, width, height, steps, cfg_scale, seed, negative_prompt }) {
    try {
      if (!model_id) return { ok: false, error: 'model_id is required' };
      if (!prompt)   return { ok: false, error: 'prompt is required' };

      const _aq = require('../aquarium');
      const fs2 = require('fs').promises;
      const safeFilename = (filename || `generated_${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');

      // Create a task to track progress in the right panel
      let taskId = null;
      try {
        const taskObj = await this.rm.createTask({
          title: `🎨 Generate: ${prompt.slice(0, 55)}`,
          description: `Model: ${model_id}\nPrompt: ${prompt}\nSize: ${width||512}x${height||512}`,
          task_type: 'image_generation',
          project_id: project_id || null,
        });
        taskId = taskObj?.task_id || taskObj;
        // Force status to in_progress immediately (createTask always starts as 'planned')
        if (taskId) {
          this.rm.invalidateCache();
          const reg = await this.rm.getTasksRegistry();
          if (reg.tasks?.[taskId]) {
            reg.tasks[taskId].status = 'in_progress';
            reg.tasks[taskId].lifecycle = {
              ...reg.tasks[taskId].lifecycle,
              status: 'in_progress',
              started_at: new Date().toISOString()
            };
            await this.rm.write('tasks/tasks_registry.json', reg);
          }
        }
      } catch(e) { console.warn('[generateImage] task creation failed:', e.message); }

      // Output always goes to TASKS/output/<taskId-or-ts>/ — never to legacy generated/
      const AQUARIUM = require('../aquarium');
      // Use taskId if available, else a timestamp-based folder so path is always under TASKS
      const outputSlot = taskId || `img_${Date.now()}`;
      const outputDir  = require('path').join(AQUARIUM.TASKS, outputSlot, 'output');
      const serveUrl   = `/api/files/read?path=${encodeURIComponent(require('path').join(AQUARIUM.TASKS, outputSlot, 'output', safeFilename))}`;
      await fs2.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, safeFilename);

      if (!this.modelService) return { ok: false, error: 'modelService not available' };

      const result = await this.modelService.generateImage({
        modelId: model_id, prompt, outputPath,
        width: width || 512, height: height || 512,
        steps: steps || 20, cfg: cfg_scale || 7,
        seed: seed ?? -1, negativePrompt: negative_prompt || ''
      });

      // Update task status
      if (taskId) {
        try {
          const finalStatus = result.ok ? 'completed' : 'failed';
          const reg = await this.rm.getTasksRegistry();
          if (reg.tasks[taskId]) {
            reg.tasks[taskId].lifecycle = { status: finalStatus, completed_at: new Date().toISOString() };
            reg.tasks[taskId].status = finalStatus;
            if (result.ok) reg.tasks[taskId].output_preview = serveUrl;
            await this.rm.write('tasks/tasks_registry.json', reg);
          }
        } catch(e) { console.warn('[generateImage] task update failed:', e.message); }
      }

      if (!result.ok) return result;
      return { ok: true, url: serveUrl, outputPath: result.outputPath, bytes: result.bytes,
               filename: safeFilename, task_id: taskId,
               markdown: `![${prompt.slice(0,40)}](${serveUrl})` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = OrchestratorTools;
