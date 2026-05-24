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
      .then(res => {
        // Check if response is JSON or plain text
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return res.json();
        } else {
          // Plain text response
          return res.text().then(text => ({ success: true, content: text }));
        }
      })
      .then(data => {
        if (data.success || data.content) {
          document.getElementById('temple-editor').value = data.content || data;
          
          // Auto-preview if HTML
          if (filename.endsWith('.html')) {
            this.refreshPreview();
          }
        } else {
          document.getElementById('temple-editor').value = '// File not found';
        }
      })
      .catch(err => {
        console.error('Failed to load file:', err);
        document.getElementById('temple-editor').value = `// Failed to load file: ${err.message}\n// This is a placeholder - file API might not be implemented yet`;
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
  },

  /**
   * Create new file in project
   */
  createProjectFile() {
    const filename = prompt('Enter filename (e.g. script.js, style.css):');
    if (!filename) return;
    
    this.currentFile = filename;
    this.currentFilePath = `/projects/${filename}`;
    
    document.getElementById('editor-filename').textContent = filename;
    document.getElementById('temple-editor').value = '// New file';
    
    console.log('✨ Created new file:', filename);
  },

  /**
   * Create new folder in project
   */
  createProjectFolder() {
    const foldername = prompt('Enter folder name:');
    if (!foldername) return;
    
    alert(`Folder "${foldername}" created!\n\nYou can now create files inside it.`);
    console.log('📁 Created folder:', foldername);
  }
};

if (typeof window !== 'undefined') {
  window.templeIDE = templeIDE;
}

console.log('💻 Temple IDE loaded');
