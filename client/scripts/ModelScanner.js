/**
 * Local Model Scanner for Poseidon
 * Scans computer for GGUF models and allows connection to Poseidon chat
 */

class ModelScanner {
  constructor() {
    this.models = [];
    this.scanning = false;
    this.selectedModel = null;
  }

  /**
   * Scan for local GGUF models
   */
  async scanLocalModels() {
    console.log('🔍 Scanning for local models...');
    this.scanning = true;
    
    try {
      const response = await fetch('/api/models/scan');
      const data = await response.json();
      
      console.log('📦 Scan result:', data);
      
      if (data.success) {
        this.models = data.models || [];
        console.log(`✅ Found ${this.models.length} models`);
        return this.models;
      } else {
        console.error('❌ Scan failed:', data.error);
        return [];
      }
    } catch (error) {
      console.error('❌ Scan error:', error);
      return [];
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Load a specific model
   */
  async loadModel(modelPath) {
    console.log('📥 Loading model:', modelPath);
    
    try {
      const response = await fetch('/api/models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: modelPath })
      });
      
      const data = await response.json();
      console.log('📦 Load result:', data);
      
      if (data.success) {
        this.selectedModel = modelPath;
        console.log('✅ Model loaded successfully!');
        
        // Connect to Poseidon
        if (typeof poseidon !== 'undefined') {
          await poseidon.initialize(modelPath);
        }
        
        return true;
      } else {
        console.error('❌ Load failed:', data.error);
        alert('Failed to load model: ' + (data.error || 'Unknown error'));
        return false;
      }
    } catch (error) {
      console.error('❌ Load error:', error);
      alert('Error loading model: ' + error.message);
      return false;
    }
  }

  /**
   * Get loaded models
   */
  async getLoadedModels() {
    try {
      const response = await fetch('/api/models/loaded');
      const data = await response.json();
      console.log('📦 Loaded models:', data);
      return data.models || [];
    } catch (error) {
      console.error('❌ Error getting loaded models:', error);
      return [];
    }
  }

  /**
   * Show model selector UI
   */
  async showModelSelector() {
    // Scan for models
    const models = await this.scanLocalModels();
    
    // Create UI
    const html = `
      <div class="model-selector">
        <h3>🔍 Select Model for Poseidon</h3>
        ${models.length === 0 ? `
          <p class="no-models">No models found. Make sure you have GGUF models installed.</p>
          <p class="hint">Expected locations:</p>
          <ul>
            <li>~/.cache/huggingface/</li>
            <li>~/models/</li>
            <li>/usr/local/share/models/</li>
          </ul>
        ` : `
          <div class="model-list">
            ${models.map(model => `
              <div class="model-item" onclick="modelScanner.loadModel('${model.path}')">
                <span class="model-name">${model.name}</span>
                <span class="model-size">${this.formatSize(model.size)}</span>
                <span class="model-path">${model.path}</span>
              </div>
            `).join('')}
          </div>
        `}
        <button onclick="modelScanner.scanLocalModels().then(m => modelScanner.showModelSelector())" class="btn-scan">
          🔄 Rescan
        </button>
      </div>
    `;
    
    // Show in modal or panel
    const panel = document.getElementById('model-selector-panel');
    if (panel) {
      panel.innerHTML = html;
      panel.classList.remove('hidden');
    } else {
      // Create panel
      const div = document.createElement('div');
      div.id = 'model-selector-panel';
      div.className = 'panel';
      div.innerHTML = html;
      document.body.appendChild(div);
    }
  }

  formatSize(bytes) {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb > 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }
}

// Global instance
const modelScanner = new ModelScanner();

// Make available globally
if (typeof window !== 'undefined') {
  window.modelScanner = modelScanner;
  window.ModelScanner = ModelScanner;
}

console.log('🔍 ModelScanner loaded');
