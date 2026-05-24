const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Local Model Scanner - Deep PC scan for GGUF models
 * 
 * Searches:
 * - HuggingFace cache
 * - Common model directories
 * - User-specified paths
 * - Ollama models
 * - LM Studio models
 */
class LocalModelScanner {
  constructor() {
    this.foundModels = [];
    
    // Common model locations
    this.searchPaths = [
      // HuggingFace
      path.join(os.homedir(), '.cache/huggingface/hub'),
      
      // Ollama
      path.join(os.homedir(), '.ollama/models'),
      
      // LM Studio
      path.join(os.homedir(), '.cache/lm-studio/models'),
      path.join(os.homedir(), 'LM Studio/models'),
      
      // SquidMind local
      path.join(__dirname, '../../data/models'),
      
      // Common download locations
      path.join(os.homedir(), 'Downloads'),
      path.join(os.homedir(), 'Documents/AI Models'),
      path.join(os.homedir(), 'Documents/Models'),
      
      // Windows common paths
      process.platform === 'win32' ? 'C:/Models' : null,
      process.platform === 'win32' ? 'C:/AI/Models' : null,
      
      // Linux common paths
      process.platform === 'linux' ? '/opt/models' : null,
      process.platform === 'linux' ? '/usr/local/models' : null,
      
      // Mac common paths
      process.platform === 'darwin' ? '/Applications/LM Studio.app/Contents/Resources/models' : null,
    ].filter(Boolean);
  }

  /**
   * Full system scan for GGUF models
   */
  async scanSystem() {
    console.log('🔍 Starting deep model scan...');
    this.foundModels = [];

    // Scan all paths
    for (const searchPath of this.searchPaths) {
      await this.scanDirectory(searchPath);
    }

    // Remove duplicates (same file in multiple locations)
    this.foundModels = this.deduplicateModels(this.foundModels);

    console.log(`✅ Scan complete: Found ${this.foundModels.length} models`);
    
    return this.foundModels;
  }

  /**
   * Scan a directory recursively for GGUF files
   */
  async scanDirectory(dirPath, depth = 0, maxDepth = 5) {
    // Avoid infinite recursion
    if (depth > maxDepth) return;

    try {
      // Check if directory exists
      const exists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (!exists) return;

      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);

        // Skip certain directories
        if (this.shouldSkip(item.name)) continue;

        if (item.isDirectory()) {
          // Recurse into subdirectories
          await this.scanDirectory(fullPath, depth + 1, maxDepth);
        } else if (item.isFile() && this.isModelFile(item.name)) {
          // Found a model file
          await this.addModel(fullPath);
        }
      }
    } catch (error) {
      // Silent fail for permission errors
      if (error.code !== 'EACCES' && error.code !== 'EPERM') {
        console.log(`⚠️  Error scanning ${dirPath}:`, error.message);
      }
    }
  }

  /**
   * Check if directory should be skipped
   */
  shouldSkip(name) {
    const skipList = [
      'node_modules',
      '.git',
      '.npm',
      '.cache',
      'System Volume Information',
      '$RECYCLE.BIN',
      'Windows',
      'Program Files',
      'Program Files (x86)',
      'AppData/Local/Temp'
    ];

    return skipList.some(skip => name.includes(skip));
  }

  /**
   * Check if file is a model file
   */
  isModelFile(filename) {
    const modelExtensions = [
      '.gguf',
      '.ggml',
      '.bin',     // Old llama.cpp format
      '.safetensors'  // HuggingFace format
    ];

    return modelExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Add model with metadata
   */
  async addModel(fullPath) {
    try {
      const stats = await fs.stat(fullPath);
      const filename = path.basename(fullPath);
      
      // Extract model info from filename
      const modelInfo = this.parseModelName(filename);

      const model = {
        name: modelInfo.name,
        file: filename,
        full_path: fullPath,
        size_mb: Math.round(stats.size / 1024 / 1024),
        size_bytes: stats.size,
        format: this.getModelFormat(filename),
        source: this.detectSource(fullPath),
        quantization: modelInfo.quantization,
        parameters: modelInfo.parameters,
        created: stats.birthtime,
        modified: stats.mtime,
        directory: path.dirname(fullPath)
      };

      this.foundModels.push(model);
    } catch (error) {
      console.log(`⚠️  Error reading ${fullPath}:`, error.message);
    }
  }

  /**
   * Parse model name for metadata
   */
  parseModelName(filename) {
    const name = filename.replace(/\.(gguf|ggml|bin|safetensors)$/i, '');
    
    // Extract quantization (Q4_K_M, Q5_0, etc.)
    const quantMatch = name.match(/Q(\d+)_([A-Z0-9]+)/i);
    const quantization = quantMatch ? quantMatch[0] : null;
    
    // Extract parameter count (7B, 13B, 70B, etc.)
    const paramMatch = name.match(/(\d+)B/i);
    const parameters = paramMatch ? `${paramMatch[1]}B` : null;
    
    return {
      name,
      quantization,
      parameters
    };
  }

  /**
   * Get model format
   */
  getModelFormat(filename) {
    if (filename.endsWith('.gguf')) return 'GGUF';
    if (filename.endsWith('.ggml')) return 'GGML';
    if (filename.endsWith('.bin')) return 'BIN';
    if (filename.endsWith('.safetensors')) return 'SafeTensors';
    return 'Unknown';
  }

  /**
   * Detect source based on path
   */
  detectSource(fullPath) {
    if (fullPath.includes('huggingface')) return 'HuggingFace';
    if (fullPath.includes('ollama')) return 'Ollama';
    if (fullPath.includes('lm-studio') || fullPath.includes('LM Studio')) return 'LM Studio';
    if (fullPath.includes('squidmind')) return 'SquidMind';
    return 'Local';
  }

  /**
   * Remove duplicate models (same file, different paths)
   */
  deduplicateModels(models) {
    const seen = new Map();

    for (const model of models) {
      const key = `${model.file}_${model.size_bytes}`;
      
      if (!seen.has(key)) {
        seen.set(key, model);
      } else {
        // Keep the one from most reliable source
        const existing = seen.get(key);
        const priority = ['HuggingFace', 'Ollama', 'LM Studio', 'SquidMind', 'Local'];
        
        const existingPriority = priority.indexOf(existing.source);
        const newPriority = priority.indexOf(model.source);
        
        if (newPriority < existingPriority) {
          seen.set(key, model);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Search for specific model by name
   */
  async findModel(searchTerm) {
    if (this.foundModels.length === 0) {
      await this.scanSystem();
    }

    const term = searchTerm.toLowerCase();
    
    return this.foundModels.filter(model => 
      model.name.toLowerCase().includes(term) ||
      model.file.toLowerCase().includes(term)
    );
  }

  /**
   * Get models by source
   */
  getModelsBySource(source) {
    return this.foundModels.filter(m => m.source === source);
  }

  /**
   * Get models by format
   */
  getModelsByFormat(format) {
    return this.foundModels.filter(m => m.format === format);
  }

  /**
   * Get recommended models (most common/popular)
   */
  getRecommendedModels() {
    // Prioritize by:
    // 1. GGUF format (newest)
    // 2. Reasonable size (4GB-10GB)
    // 3. Recent modification date
    
    return this.foundModels
      .filter(m => m.format === 'GGUF')
      .filter(m => m.size_mb >= 2000 && m.size_mb <= 10000)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 5);
  }

  /**
   * Generate stats
   */
  getStats() {
    return {
      total_models: this.foundModels.length,
      by_format: this.countByKey('format'),
      by_source: this.countByKey('source'),
      by_quantization: this.countByKey('quantization'),
      total_size_gb: (this.foundModels.reduce((sum, m) => sum + m.size_mb, 0) / 1024).toFixed(2),
      largest_model: this.foundModels.reduce((max, m) => m.size_mb > max.size_mb ? m : max, { size_mb: 0 }),
      smallest_model: this.foundModels.reduce((min, m) => m.size_mb < min.size_mb && m.size_mb > 0 ? m : min, { size_mb: Infinity })
    };
  }

  /**
   * Count by key
   */
  countByKey(key) {
    const counts = {};
    
    for (const model of this.foundModels) {
      const value = model[key] || 'Unknown';
      counts[value] = (counts[value] || 0) + 1;
    }
    
    return counts;
  }
}

// Singleton
const localModelScanner = new LocalModelScanner();

module.exports = localModelScanner;
