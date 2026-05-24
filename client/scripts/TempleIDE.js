/**
 * Temple IDE - Integrated Development Environment
 * Features: Text/Code editor + Live HTML previewer
 */

const templeIDE = {
  currentFile: null,
  currentFilePath: null,

  /**
   * Open file in editor
   */
  openFile(filename, filepath) {
    console.log('📝 Opening file:', filename, filepath);
    
    this.currentFile = filename;
    this.currentFilePath = filepath;
    
    // Update filename display
    document.getElementById('editor-filename').textContent = filename;
    
    // Load file content
    fetch(`/api/files/read?path=${encodeURIComponent(filepath)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          document.getElementById('temple-editor').value = data.content;
          
          // Auto-preview if HTML
          if (filename.endsWith('.html')) {
            this.refreshPreview();
          }
        }
      })
      .catch(err => {
        console.error('Failed to load file:', err);
        document.getElementById('temple-editor').value = '// Failed to load file';
      });
  },

  /**
   * Save current file
   */
  saveFile() {
    if (!this.currentFile) {
      alert('No file open');
      return;
    }
    
    const content = document.getElementById('temple-editor').value;
    
    fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: this.currentFilePath,
        content: content
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('File saved!');
          this.refreshPreview();
        } else {
          alert('Failed to save: ' + data.error);
        }
      })
      .catch(err => {
        console.error('Save failed:', err);
        alert('Save error: ' + err.message);
      });
  },

  /**
   * Refresh preview iframe
   */
  refreshPreview() {
    const content = document.getElementById('temple-editor').value;
    const preview = document.getElementById('temple-preview');
    
    // Write content to iframe
    const doc = preview.contentDocument || preview.contentWindow.document;
    doc.open();
    doc.write(content);
    doc.close();
  },

  /**
   * Create new project
   */
  createNewProject() {
    const projectName = prompt('Enter project name:');
    if (!projectName) return;
    
    // Create new project with template
    const template = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${projectName}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
    }
  </style>
</head>
<body>
  <h1>🏛️ ${projectName}</h1>
  <p>Your project starts here!</p>
</body>
</html>`;
    
    this.currentFile = `${projectName}.html`;
    this.currentFilePath = `/projects/${projectName}.html`;
    
    document.getElementById('editor-filename').textContent = this.currentFile;
    document.getElementById('temple-editor').value = template;
    
    this.refreshPreview();
  }
};

if (typeof window !== 'undefined') {
  window.templeIDE = templeIDE;
}

console.log('💻 Temple IDE loaded');
