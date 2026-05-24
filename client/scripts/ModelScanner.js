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
        
        <!-- Manual Path Input -->
        <div class="manual-path-section">
          <h4>📂 Manual Path</h4>
          <input type="text" id="manual-model-path" placeholder="/path/to/your/model.gguf" 
                 style="width: 100%; padding: 8px; margin: 8px 0; font-family: monospace; font-size: 11px;">
          <button onclick="modelScanner.loadModelByPath()" class="btn-load-manual">
            📥 Load from Path
          </button>
        </div>
        
        <hr style="margin: 20px 0; border-color: var(--border);">
        
        ${models.length === 0 ? `
          <p class="no-models">No models found in scan. Use manual path above.</p>
          <p class="hint">Common locations:</p>
          <ul>
            <li>~/.cache/huggingface/hub/models--*/snapshots/*/*.gguf</li>
            <li>~/models/*.gguf</li>
            <li>/usr/local/share/models/*.gguf</li>
          </ul>
        ` : `
          <h4>📦 Found Models (${models.length})</h4>
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
        <button onclick="document.getElementById('model-selector-panel').classList.add('hidden')" class="btn-close-scanner">
          ✕ Close
        </button>
      </div>
    `;
    
    // Show in modal or panel
    let panel = document.getElementById('model-selector-panel');
    if (panel) {
      panel.innerHTML = html;
      panel.classList.remove('hidden');
    } else {
      // Create panel
      panel = document.createElement('div');
      panel.id = 'model-selector-panel';
      panel.className = 'panel model-scanner-panel';
      panel.innerHTML = html;
      document.body.appendChild(panel);
    }
  }

  /**
   * Load model from manual path input
   */
  async loadModelByPath() {
    const input = document.getElementById('manual-model-path');
    const path = input.value.trim();
    
    if (!path) {
      alert('Please enter a model path');
      return;
    }
    
    console.log('📥 Loading model from manual path:', path);
    const success = await this.loadModel(path);
    
    if (success) {
      alert('Model loaded successfully!');
      document.getElementById('model-selector-panel').classList.add('hidden');
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
