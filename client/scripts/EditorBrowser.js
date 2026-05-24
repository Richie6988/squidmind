/**
 * EditorBrowser - Opens a modal with editable JSON files
 * 
 * Lists all registries and entity files, lets user pick one to edit.
 */

const EditorBrowser = {
  modal: null,
  currentEditor: null,

  // All editable files organized by category
  fileMap: {
    'Poseidon Brain (the Conductor)': [
      { path: 'main/poseidon_brain.json', label: 'Global Brain' }
    ],
    'Agents': [
      { path: 'agents/agent_registry.json', label: 'Agent Registry' }
    ],
    'Projects': [
      { path: 'projects/project_registry.json', label: 'Project Registry' },
      { path: 'projects/PROJECT_001/project_memory.json', label: 'PROJECT_001 (AQUARIUM)' },
      { path: 'projects/PROJECT_002/project_memory.json', label: 'PROJECT_002 (TRADING)' },
      { path: 'projects/PROJECT_003/project_memory.json', label: 'PROJECT_003 (BRAIN)' },
      { path: 'projects/PROJECT_004/project_memory.json', label: 'PROJECT_004 (NEWSROOM)' }
    ],
    'Tasks': [
      { path: 'tasks/tasks_registry.json', label: 'Task Registry' }
    ],
    'Teams': [
      { path: 'teams/team_registry.json', label: 'Team Registry' }
    ],
    'Models': [
      { path: 'models/model_registry.json', label: 'Model Registry' }
    ],
    'Tools': [
      { path: 'tools/tool_registry.json', label: 'Tool Registry' },
      { path: 'tools/read_file.json', label: 'read_file spec (local_function)' },
      { path: 'tools/web_search.json', label: 'web_search spec (api_call)' },
      { path: 'tools/github_mcp.json', label: 'github_mcp spec (mcp_server)' }
    ],
    'Logs (read-only view)': [
      { path: 'logs/logs.json', label: 'Logs' },
      { path: 'logs/checkpoints.json', label: 'Checkpoints' }
    ]
  },

  open() {
    this._buildModal();
    this._showFileList();
  },

  _buildModal() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      return;
    }

    this.modal = document.createElement('div');
    this.modal.className = 'modal editor-browser-modal';
    this.modal.innerHTML = `
      <div class="modal-content" style="width: 90vw; max-width: 1100px; height: 85vh;">
        <div class="modal-header">
          <h2>JSON Registry Editor</h2>
          <button class="btn-close" onclick="EditorBrowser.close()">x</button>
        </div>
        <div class="modal-body" style="display: flex; gap: 12px; height: calc(100% - 60px); padding: 12px;">
          <div class="editor-browser-sidebar" style="width: 280px; overflow-y: auto; border-right: 2px solid var(--border); padding-right: 12px;"></div>
          <div class="editor-browser-content" style="flex: 1; overflow: hidden;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
  },

  _showFileList() {
    const sidebar = this.modal.querySelector('.editor-browser-sidebar');
    const content = this.modal.querySelector('.editor-browser-content');
    
    sidebar.innerHTML = '';
    for (const [category, files] of Object.entries(this.fileMap)) {
      const section = document.createElement('div');
      section.className = 'editor-browser-section';
      section.style.marginBottom = '12px';
      
      const title = document.createElement('div');
      title.style.cssText = 'font-size: 9px; color: var(--accent); margin-bottom: 4px; font-weight: bold;';
      title.textContent = category;
      section.appendChild(title);
      
      for (const file of files) {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.style.cssText = 'width: 100%; text-align: left; padding: 6px 8px; margin: 2px 0; font-size: 9px;';
        btn.textContent = file.label;
        btn.title = file.path;
        btn.addEventListener('click', () => this._openFile(file.path, btn));
        section.appendChild(btn);
      }
      sidebar.appendChild(section);
    }
    
    content.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-secondary); font-size: 10px;">
        <p>Select a file from the left to start editing.</p>
        <p style="margin-top: 16px; font-size: 9px;">All changes are validated and logged automatically.</p>
        <p style="font-size: 9px;">Read-only fields (IDs, timestamps, computed values) are protected.</p>
      </div>
    `;
  },

  async _openFile(filePath, buttonEl) {
    // Highlight selected
    this.modal.querySelectorAll('.editor-browser-sidebar button').forEach(b => b.classList.remove('selected'));
    buttonEl.classList.add('selected');
    
    const content = this.modal.querySelector('.editor-browser-content');
    content.innerHTML = '<div style="padding: 20px; color: var(--text-secondary);">Loading...</div>';
    
    try {
      const editorDiv = document.createElement('div');
      editorDiv.style.cssText = 'height: 100%; overflow: hidden;';
      content.innerHTML = '';
      content.appendChild(editorDiv);
      
      this.currentEditor = new JsonEditor(filePath, editorDiv);
      await this.currentEditor.load();
      this.currentEditor.render();
    } catch (err) {
      content.innerHTML = `<div style="padding: 20px; color: var(--danger);">Error: ${err.message}</div>`;
    }
  },

  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
    this.currentEditor = null;
  }
};

window.EditorBrowser = EditorBrowser;
console.log('[OK] EditorBrowser loaded');
