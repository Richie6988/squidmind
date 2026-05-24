// ==================== BRAIN.JSON EDITOR MODAL ====================

const BrainEditor = {
  currentBrain: null,
  
  open: async function() {
    try {
      const response = await fetch('/api/brain');
      const data = await response.json();
      
      if (!data.success) {
        alert('❌ Failed to load brain.json: ' + data.error);
        return;
      }
      
      this.currentBrain = data.brain;
      this.showModal();
      this.populateForm();
    } catch (error) {
      alert('❌ Error loading brain.json: ' + error.message);
    }
  },
  
  showModal: function() {
    let modal = document.getElementById('brain-editor-modal');
    
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'brain-editor-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content" style="width: 700px; max-height: 80vh; overflow-y: auto;">
          <div class="modal-header">
            <h2>🧠 brain.json Editor</h2>
            <button class="btn-close" onclick="BrainEditor.close()">✕</button>
          </div>
          <div class="modal-body">
            <form id="brain-editor-form" onsubmit="BrainEditor.save(event)">
              
              <div class="form-section">
                <h3>System Info</h3>
                <div class="form-group">
                  <label>System Name</label>
                  <input type="text" name="system.name" id="brain-system-name" />
                </div>
                <div class="form-group">
                  <label>Description</label>
                  <textarea name="system.description" id="brain-system-description"></textarea>
                </div>
                <div class="form-group">
                  <label>Poseidon Personality</label>
                  <textarea name="system.poseidon_personality" id="brain-poseidon-personality"></textarea>
                </div>
              </div>
              
              <div class="form-section">
                <h3>Settings</h3>
                <div class="form-group">
                  <label>
                    <input type="checkbox" name="settings.auto_save" id="brain-auto-save" />
                    Auto Save
                  </label>
                </div>
                <div class="form-group">
                  <label>
                    <input type="checkbox" name="settings.debug_mode" id="brain-debug-mode" />
                    Debug Mode
                  </label>
                </div>
                <div class="form-group">
                  <label>Theme</label>
                  <select name="settings.theme" id="brain-theme">
                    <option value="ocean">Ocean</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
              </div>
              
              <div class="form-section">
                <h3>Advanced (JSON)</h3>
                <textarea id="brain-json-raw" style="width: 100%; min-height: 200px; font-family: monospace; font-size: 10px;"></textarea>
              </div>
              
              <div class="form-actions">
                <button type="submit" class="btn-primary">💾 Save Changes</button>
                <button type="button" class="btn-secondary" onclick="BrainEditor.close()">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    
    modal.classList.remove('hidden');
  },
  
  populateForm: function() {
    if (!this.currentBrain) return;
    
    // System fields
    document.getElementById('brain-system-name').value = this.currentBrain.system?.name || '';
    document.getElementById('brain-system-description').value = this.currentBrain.system?.description || '';
    document.getElementById('brain-poseidon-personality').value = this.currentBrain.system?.poseidon_personality || '';
    
    // Settings
    document.getElementById('brain-auto-save').checked = this.currentBrain.settings?.auto_save || false;
    document.getElementById('brain-debug-mode').checked = this.currentBrain.settings?.debug_mode || false;
    document.getElementById('brain-theme').value = this.currentBrain.settings?.theme || 'ocean';
    
    // Raw JSON
    document.getElementById('brain-json-raw').value = JSON.stringify(this.currentBrain, null, 2);
  },
  
  save: async function(event) {
    event.preventDefault();
    
    try {
      // Get form values
      const brain = {
        version: this.currentBrain.version,
        system: {
          name: document.getElementById('brain-system-name').value,
          description: document.getElementById('brain-system-description').value,
          poseidon_personality: document.getElementById('brain-poseidon-personality').value
        },
        models: this.currentBrain.models || { loaded: [], default: null },
        agents: this.currentBrain.agents || { total: 0, active: 0 },
        projects: this.currentBrain.projects || { total: 0, active: [] },
        processes: this.currentBrain.processes || { total: 0, active: [] },
        settings: {
          auto_save: document.getElementById('brain-auto-save').checked,
          debug_mode: document.getElementById('brain-debug-mode').checked,
          theme: document.getElementById('brain-theme').value
        }
      };
      
      // Try to parse raw JSON (if user edited it)
      try {
        const rawJson = document.getElementById('brain-json-raw').value;
        const parsed = JSON.parse(rawJson);
        Object.assign(brain, parsed);
      } catch (e) {
        // Use form values if JSON is invalid
        console.warn('Raw JSON invalid, using form values');
      }
      
      // Save to backend
      const response = await fetch('/api/brain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brain })
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert('✅ brain.json saved successfully!');
        this.close();
      } else {
        alert('❌ Failed to save: ' + data.error);
      }
    } catch (error) {
      alert('❌ Error saving: ' + error.message);
    }
  },
  
  close: function() {
    const modal = document.getElementById('brain-editor-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }
};

// Make globally available
window.BrainEditor = BrainEditor;

console.log('✅ Brain editor loaded');
