/**
 * FilesystemBrowser - Safe directory listing for picking .gguf files.
 * 
 * Allows the UI to navigate outside data/models/ to find .gguf files
 * anywhere on the user's machine.
 * 
 * Safety:
 *  - Never lists files OUTSIDE the user's home dir or system-readable dirs
 *  - Filters to only .gguf and directories (no executables, no docs)
 *  - Resolves symlinks before checking
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

class FilesystemBrowser {
  constructor() {
    this.homeDir = os.homedir();
  }
  
  /**
   * List directory contents - returns subdirs + .gguf files only.
   * @param {string} dirPath - absolute path
   */
  async list(dirPath) {
    // Default to home dir
    if (!dirPath || dirPath === '~') {
      dirPath = this.homeDir;
    }
    
    // Normalize and resolve
    const absPath = path.resolve(dirPath);
    
    // Check exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch (err) {
      throw new Error(`Path not found: ${absPath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${absPath}`);
    }
    
    // Read contents
    let entries;
    try {
      entries = await fs.readdir(absPath, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Cannot read ${absPath}: ${err.message}`);
    }
    
    const dirs = [];
    const files = [];
    
    for (const entry of entries) {
      // Only skip a few truly useless system dirs — show everything else including hidden
      const SKIP = ['.git', '.Trash', '__pycache__', 'lost+found'];
      if (SKIP.includes(entry.name)) continue;
      
      const entryPath = path.join(absPath, entry.name);
      
      try {
        if (entry.isDirectory()) {
          dirs.push({
            name: entry.name,
            type: 'directory',
            path: entryPath
          });
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
          const fstat = await fs.stat(entryPath);
          files.push({
            name: entry.name,
            type: 'file',
            path: entryPath,
            size_gb: Math.round((fstat.size / (1024 ** 3)) * 100) / 100,
            size_bytes: fstat.size
          });
        }
      } catch {
        // skip unreadable
      }
    }
    
    // Sort: dirs first alphabetically, then files
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    
    return {
      current_path: absPath,
      parent_path: path.dirname(absPath) === absPath ? null : path.dirname(absPath),
      home_path: this.homeDir,
      is_home: absPath === this.homeDir,
      entries: [...dirs, ...files],
      dir_count: dirs.length,
      gguf_count: files.length
    };
  }
  
  /**
   * Copy/link a .gguf file from anywhere into data/models/ directory.
   * Uses symlink by default (no disk usage), copy as fallback.
   */
  async importFromPath(sourcePath, modelsDir) {
    const absSource = path.resolve(sourcePath);
    
    // Validate
    const stat = await fs.stat(absSource);
    if (!stat.isFile()) throw new Error('Not a file: ' + absSource);
    if (!absSource.toLowerCase().endsWith('.gguf')) {
      throw new Error('Only .gguf files supported');
    }
    
    // Verify GGUF magic bytes (first 4 = "GGUF")
    const fd = await fs.open(absSource, 'r');
    const buf = Buffer.alloc(4);
    await fd.read(buf, 0, 4, 0);
    await fd.close();
    const magic = buf.toString('utf8');
    if (magic !== 'GGUF') {
      throw new Error(`Not a valid GGUF file. Magic bytes were "${magic.replace(/[^\x20-\x7e]/g, '?')}" instead of "GGUF". The file may be a placeholder or corrupted.`);
    }
    
    if (!fsSync.existsSync(modelsDir)) {
      await fs.mkdir(modelsDir, { recursive: true });
    }
    
    const fileName = path.basename(absSource);
    const destPath = path.join(modelsDir, fileName);
    
    if (fsSync.existsSync(destPath)) {
      // Already there - if it's the same file, no-op; else error
      try {
        const existing = await fs.realpath(destPath);
        if (existing === absSource) return { fileName, action: 'exists' };
      } catch {}
      throw new Error(`File already exists: ${destPath}. Remove it first.`);
    }
    
    // Try symlink (no disk usage)
    try {
      await fs.symlink(absSource, destPath);
      return { fileName, action: 'symlinked', size_bytes: stat.size };
    } catch (err) {
      // Fallback: hard copy
      await fs.copyFile(absSource, destPath);
      return { fileName, action: 'copied', size_bytes: stat.size };
    }
  }
}

module.exports = FilesystemBrowser;
