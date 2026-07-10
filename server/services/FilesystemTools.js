const fs = require('fs').promises;
const path = require('path');
const log = require('../utils/logger').createLogger('FilesystemTools');
const { execSync } = require('child_process');
const AQUARIUM = require('../aquarium');

/**
 * Filesystem Tools for Agents
 * 
 * Provides safe file operations:
 * - create_directory
 * - write_file
 * - read_file
 * - list_directory
 * - directory_tree
 * - search_files
 * - get_file_info
 * - move_file
 * - run_javascript
 * - read_media_file
 */
class FilesystemTools {
  constructor() {
    // Base working directory (sandboxed)
    const AQUARIUM = require('../aquarium');
    this.workDir = AQUARIUM.ROOT;
    this.maxFileSize = 10 * 1024 * 1024; // 10MB max
    this.allowedExtensions = [
      '.js', '.ts', '.jsx', '.tsx',
      '.json', '.yaml', '.yml',
      '.md', '.txt', '.csv',
      '.html', '.css', '.scss',
      '.py', '.rb', '.go', '.rs',
      '.sh', '.bash',
      '.sql',
      '.png', '.jpg', '.jpeg', '.gif', '.svg',
      '.mp3', '.wav', '.ogg'
    ];
  }

  async init() {
    // Ensure workspace exists
    await fs.mkdir(this.workDir, { recursive: true });
    log.info('📁 Filesystem tools initialized');
    log.info(`   Workspace: ${this.workDir}`);
  }

  /**
   * Validate path is within workspace
   */
  validatePath(relativePath) {
    // Resolve AQUARIUM paths (e.g. 'models/...' → 'MODELS/...')
    const resolvedRel = AQUARIUM.resolve(relativePath);
    const fullPath = path.join(this.workDir, resolvedRel);
    const resolved = path.resolve(fullPath);
    
    if (!resolved.startsWith(this.workDir)) {
      throw new Error('Path outside workspace not allowed');
    }

    return resolved;
  }

  /**
   * validateWritePath — everything validatePath does, PLUS the project
   * structure contract for WRITE operations (write_file / create_directory):
   *
   *   PROJECTS/<name>/input/   ← source material (usually written by humans)
   *   PROJECTS/<name>/output/  ← FINAL DELIVERABLES ONLY
   *   PROJECTS/<name>/work/    ← scratch space for intermediate files
   *
   * Agents had a habit of inventing folder trees (notes/, thoughts/,
   * analysis/, drafts/…) and saving reasoning dumps into output/. Reads
   * stay unrestricted; writes inside a project must target one of the
   * three sanctioned subdirs. Reasoning/notes belong in project memory
   * (update_project_memory), not in files — the dream system condenses
   * memory, it can't condense a folder maze.
   */
  validateWritePath(relativePath) {
    const resolved = this.validatePath(relativePath);
    const rel = path.relative(this.workDir, resolved);
    const parts = rel.split(path.sep);
    if (parts[0] === 'PROJECTS' && parts.length > 2) {
      const sub = parts[2];
      const ALLOWED = new Set(['input', 'output', 'work']);
      if (!ALLOWED.has(sub)) {
        throw new Error(
          `PROJECT STRUCTURE: writes inside a project must go to input/, output/ or work/ — not "${sub}/". ` +
          `Rules: output/ = FINAL deliverables only; work/ = intermediate/scratch files; ` +
          `reasoning, notes and plans go to update_project_memory (section "notes" or "decision"), NOT files. ` +
          `Retry with PROJECTS/${parts[1]}/work/${parts.slice(2).join('/')} if this is intermediate work.`
        );
      }
    }
    return resolved;
  }

  /**
   * Create directory
   */
  async createDirectory(relativePath) {
    try {
      const fullPath = this.validateWritePath(relativePath);
      await fs.mkdir(fullPath, { recursive: true });
      
      return {
        success: true,
        path: relativePath,
        full_path: fullPath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Write file (creates or overwrites)
   */
  async writeFile(relativePath, content) {
    try {
      const fullPath = this.validateWritePath(relativePath);
      
      // Check file size
      if (Buffer.byteLength(content, 'utf8') > this.maxFileSize) {
        throw new Error(`File too large (max ${this.maxFileSize / 1024 / 1024}MB)`);
      }
      
      // Check extension
      const ext = path.extname(fullPath);
      if (!this.allowedExtensions.includes(ext.toLowerCase())) {
        throw new Error(`File extension ${ext} not allowed`);
      }
      
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file
      await fs.writeFile(fullPath, content, 'utf8');

      // Ground-truth deliverable tracking: record what was ACTUALLY written
      // during the currently running task (single-flight makes a global safe).
      // The TaskRunner attaches this to the task result, so "files created"
      // is a verified fact instead of a model claim.
      try {
        const tid = global.__ACTIVE_TASK_ID;
        if (tid) {
          global.__TASK_WRITES = global.__TASK_WRITES || new Map();
          const arr = global.__TASK_WRITES.get(tid) || [];
          arr.push({ path: relativePath, bytes: Buffer.byteLength(content, 'utf8') });
          global.__TASK_WRITES.set(tid, arr);
        }
      } catch { /* tracking must never break the write */ }
      
      return {
        success: true,
        path: relativePath,
        full_path: fullPath,
        size: Buffer.byteLength(content, 'utf8')
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Read file (full or partial)
   */
  async readFile(relativePath, options = {}) {
    try {
      const fullPath = this.validatePath(relativePath);
      const { head, tail } = options;
      
      const content = await fs.readFile(fullPath, 'utf8');
      
      // Full content — with a CONTEXT-PROTECTION cap. Local models run on
      // small contexts (8-16k tokens); an uncapped read of a big file blows
      // the window and crashes/derails the generation. Above the cap we
      // return head+tail with an explicit truncation notice teaching the
      // head/tail options for targeted reads.
      if (!head && !tail) {
        const MAX_READ = 24_000;   // chars ≈ 6-8k tokens, safe on 8k ctx
        if (content.length > MAX_READ) {
          const headPart = content.slice(0, Math.floor(MAX_READ * 0.7));
          const tailPart = content.slice(-Math.floor(MAX_READ * 0.25));
          return {
            success: true,
            text: headPart +
              `\n\n[... TRUNCATED: file is ${content.length} chars, showing first ${headPart.length} + last ${tailPart.length}. ` +
              `Use read_file with {head: N} or {tail: N} (lines) for targeted sections. ...]\n\n` + tailPart,
            size: Buffer.byteLength(content, 'utf8'),
            truncated: true,
          };
        }
        return {
          success: true,
          text: content,
          size: Buffer.byteLength(content, 'utf8')
        };
      }
      
      // Partial read
      const lines = content.split('\n');
      let selectedLines = [];
      
      if (head) {
        selectedLines = lines.slice(0, head);
      } else if (tail) {
        selectedLines = lines.slice(-tail);
      }
      
      return {
        success: true,
        text: selectedLines.join('\n'),
        lines: selectedLines.length,
        total_lines: lines.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(relativePath = '.') {
    try {
      const fullPath = this.validatePath(relativePath);
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      
      const contents = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'DIR' : 'FILE',
        path: path.join(relativePath, item.name)
      }));
      
      return {
        success: true,
        path: relativePath,
        contents
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get directory tree (recursive)
   */
  async directoryTree(relativePath = '.', excludePatterns = []) {
    try {
      const fullPath = this.validatePath(relativePath);
      const tree = await this.buildTree(fullPath, relativePath, excludePatterns);
      
      return {
        success: true,
        tree
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build tree recursively
   */
  async buildTree(fullPath, relativePath, excludePatterns, depth = 0) {
    if (depth > 10) return null; // Prevent infinite recursion
    
    const stats = await fs.stat(fullPath);
    const name = path.basename(fullPath);
    
    // Check exclude patterns
    if (excludePatterns.some(pattern => name.includes(pattern))) {
      return null;
    }
    
    if (stats.isDirectory()) {
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const children = [];
      
      for (const item of items) {
        const childPath = path.join(fullPath, item.name);
        const childRelPath = path.join(relativePath, item.name);
        const childTree = await this.buildTree(childPath, childRelPath, excludePatterns, depth + 1);
        
        if (childTree) {
          children.push(childTree);
        }
      }
      
      return {
        name,
        type: 'DIR',
        path: relativePath,
        children
      };
    } else {
      return {
        name,
        type: 'FILE',
        path: relativePath,
        size: stats.size
      };
    }
  }

  /**
   * Search files by pattern
   */
  async searchFiles(relativePath = '.', pattern) {
    try {
      const fullPath = this.validatePath(relativePath);
      const matches = [];
      
      await this.searchRecursive(fullPath, relativePath, pattern, matches);
      
      return {
        success: true,
        pattern,
        matches
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Recursive search
   */
  async searchRecursive(fullPath, relativePath, pattern, matches, depth = 0) {
    if (depth > 10) return;
    
    const items = await fs.readdir(fullPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(fullPath, item.name);
      const itemRelPath = path.join(relativePath, item.name);
      
      if (item.isDirectory()) {
        await this.searchRecursive(itemPath, itemRelPath, pattern, matches, depth + 1);
      } else if (this.matchesPattern(item.name, pattern)) {
        matches.push(itemRelPath);
      }
    }
  }

  /**
   * Match filename against pattern
   */
  matchesPattern(filename, pattern) {
    // Simple glob-style matching
    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$',
      'i'
    );
    
    return regex.test(filename);
  }

  /**
   * Get file info/metadata
   */
  async getFileInfo(relativePath) {
    try {
      const fullPath = this.validatePath(relativePath);
      const stats = await fs.stat(fullPath);
      
      return {
        success: true,
        name: path.basename(fullPath),
        type: stats.isDirectory() ? 'DIR' : 'FILE',
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        path: relativePath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Move/rename file
   */
  async moveFile(source, destination) {
    try {
      const sourcePath = this.validatePath(source);
      const destPath = this.validateWritePath(destination);
      
      // Ensure destination directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      
      // Move file
      await fs.rename(sourcePath, destPath);
      
      return {
        success: true,
        from: source,
        to: destination
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Run JavaScript code (sandboxed)
   */
  async runJavaScript(code, timeoutSeconds = 5) {
    try {
      const maxTimeout = 60;
      const timeout = Math.min(timeoutSeconds, maxTimeout);
      
      // Create temp file
      const tempFile = path.join(this.workDir, `temp_${Date.now()}.js`);
      await fs.writeFile(tempFile, code, 'utf8');
      
      // Execute with timeout
      const result = execSync(`node ${tempFile}`, {
        timeout: timeout * 1000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 // 1MB
      });
      
      // Cleanup
      await fs.unlink(tempFile);
      
      return {
        success: true,
        stdout: result,
        stderr: '',
        timeout_seconds: timeout
      };
    } catch (error) {
      // Cleanup on error
      try {
        const tempFile = path.join(this.workDir, `temp_${Date.now()}.js`);
        await fs.unlink(tempFile);
      } catch {}
      
      return {
        success: false,
        stdout: '',
        stderr: error.stderr || error.message,
        error: error.message
      };
    }
  }

  /**
   * Read media file (images, audio)
   */
  async readMediaFile(relativePath) {
    try {
      const fullPath = this.validatePath(relativePath);
      const ext = path.extname(fullPath).toLowerCase();
      
      // Determine MIME type
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg'
      };
      
      const mimeType = mimeTypes[ext];
      if (!mimeType) {
        throw new Error(`Unsupported media type: ${ext}`);
      }
      
      // Read as buffer
      const buffer = await fs.readFile(fullPath);
      
      // Convert to base64
      const base64 = buffer.toString('base64');
      
      return {
        success: true,
        data: `data:${mimeType};base64,${base64}`,
        mimeType,
        size: buffer.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get workspace info
   */
  async getWorkspaceInfo() {
    try {
      const stats = await this.getDirectoryStats(this.workDir);
      
      return {
        success: true,
        workspace: this.workDir,
        ...stats
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get directory statistics
   */
  async getDirectoryStats(dir) {
    let fileCount = 0;
    let dirCount = 0;
    let totalSize = 0;
    
    const items = await fs.readdir(dir, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        dirCount++;
        const childStats = await this.getDirectoryStats(itemPath);
        fileCount += childStats.file_count;
        dirCount += childStats.dir_count;
        totalSize += childStats.total_size;
      } else {
        fileCount++;
        const stats = await fs.stat(itemPath);
        totalSize += stats.size;
      }
    }
    
    return {
      file_count: fileCount,
      dir_count: dirCount,
      total_size: totalSize,
      total_size_mb: (totalSize / 1024 / 1024).toFixed(2)
    };
  }
}

// Singleton
const filesystemTools = new FilesystemTools();

module.exports = filesystemTools;
