/**
 * JsonEditor - Generic JSON editor for any registry file
 * 
 * Self-describing: introspects the JSON to determine field types
 * Self-protecting: respects read-only paths from backend
 * Self-logging: every change goes through backend which logs it
 * 
 * Usage:
 *   const editor = new JsonEditor('agents/agent_registry.json', containerElement);
 *   await editor.load();
 *   editor.render();
 */

class JsonEditor {
  constructor(filePath, container) {
    this.filePath = filePath;
    this.container = container;
    this.data = null;
    this.schema = null;
    this.enums = null;
    this.dirty = new Map(); // fieldPath -> newValue (pending changes)
  }

  async load() {
    const [fileRes, schemaRes] = await Promise.all([
      window.ApiV2._fetch('/file/' + this.filePath),
      window.ApiV2._fetch('/schema/' + this.filePath)
    ]);
    this.data = fileRes.data;
    this.schema = schemaRes.schema;
    this.enums = schemaRes.enums || {};
  }

  /**
   * Render the editor in the container
   * @param {string} startPath - Optional: start rendering from a sub-path
   */
  render(startPath = '') {
    const startNode = startPath
      ? this._getSchemaAtPath(startPath)
      : this.schema;

    if (!startNode) {
      this.container.innerHTML = '<div class="json-editor-empty">Nothing to display</div>';
      return;
    }

    this.container.innerHTML = '';
    this.container.classList.add('json-editor');

    // Header with save button
    const header = document.createElement('div');
    header.className = 'json-editor-header';
    header.innerHTML = `
      <h3>${this.filePath}${startPath ? ' :: ' + startPath : ''}</h3>
      <div class="json-editor-actions">
        <button class="json-editor-save" disabled>Save changes (0)</button>
        <button class="json-editor-cancel">Cancel</button>
      </div>
      <div class="json-editor-status"></div>
    `;
    this.container.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'json-editor-body';
    this.container.appendChild(body);

    this._renderNode(body, startNode, 0);

    // Wire up save/cancel
    header.querySelector('.json-editor-save').addEventListener('click', () => this.saveAll());
    header.querySelector('.json-editor-cancel').addEventListener('click', () => this.cancelAll());
  }

  _getSchemaAtPath(path) {
    return path.split('.').reduce((node, key) => node?.fields?.[key], this.schema);
  }

  _renderNode(parentEl, node, depth) {
    if (node.type === 'object') {
      const sortedKeys = Object.keys(node.fields).sort((a, b) => {
        // Show simple fields first, then nested
        const aSimple = ['string', 'number', 'boolean'].includes(node.fields[a].type);
        const bSimple = ['string', 'number', 'boolean'].includes(node.fields[b].type);
        if (aSimple !== bSimple) return aSimple ? -1 : 1;
        return a.localeCompare(b);
      });

      for (const key of sortedKeys) {
        this._renderField(parentEl, key, node.fields[key], depth);
      }
    }
  }

  _renderField(parentEl, key, field, depth) {
    const wrapper = document.createElement('div');
    wrapper.className = `json-field json-field-${field.type} depth-${depth}`;
    if (field.readOnly) wrapper.classList.add('readonly');

    const label = document.createElement('div');
    label.className = 'json-field-label';
    label.textContent = key;
    if (field.readOnly) label.textContent += ' (read-only)';
    wrapper.appendChild(label);

    // Object: expandable section
    if (field.type === 'object') {
      const details = document.createElement('details');
      details.className = 'json-field-section';
      // Auto-open shallow objects, collapse deep ones
      if (depth < 1) details.setAttribute('open', '');
      const summary = document.createElement('summary');
      const fieldCount = Object.keys(field.fields).length;
      summary.textContent = `{${fieldCount} fields}`;
      details.appendChild(summary);
      const inner = document.createElement('div');
      inner.className = 'json-field-section-inner';
      details.appendChild(inner);
      wrapper.appendChild(details);
      this._renderNode(inner, field, depth + 1);
      parentEl.appendChild(wrapper);
      return;
    }

    // Array
    if (field.type === 'array') {
      const value = this._getValueAtPath(field.path);
      const arrayContainer = document.createElement('div');
      arrayContainer.className = 'json-field-array';
      arrayContainer.textContent = `[${value.length} items] ` + JSON.stringify(value).substring(0, 80);
      wrapper.appendChild(arrayContainer);
      parentEl.appendChild(wrapper);
      return;
    }

    // Null
    if (field.type === 'null') {
      const span = document.createElement('span');
      span.className = 'json-field-null';
      span.textContent = 'null';
      wrapper.appendChild(span);
      parentEl.appendChild(wrapper);
      return;
    }

    // Primitive - create input
    const input = this._createInput(field, key);
    wrapper.appendChild(input);
    parentEl.appendChild(wrapper);
  }

  _createInput(field, key) {
    const currentValue = this._getValueAtPath(field.path);
    let input;

    // Boolean → checkbox
    if (field.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = currentValue;
      input.disabled = field.readOnly;
      input.addEventListener('change', () => this._markDirty(field.path, input.checked));
      return input;
    }

    // Number → number input
    if (field.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.value = currentValue;
      input.step = Number.isInteger(currentValue) ? '1' : '0.01';
      input.disabled = field.readOnly;
      input.addEventListener('change', () => this._markDirty(field.path, parseFloat(input.value)));
      return input;
    }

    // String with enum hint → dropdown
    if (field.type === 'string' && key === 'status' && this.enums.status) {
      input = document.createElement('select');
      input.disabled = field.readOnly;
      for (const opt of this.enums.status) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === currentValue) o.selected = true;
        input.appendChild(o);
      }
      input.addEventListener('change', () => this._markDirty(field.path, input.value));
      return input;
    }

    // String with type enum
    if (field.type === 'string' && key === 'type' && this.enums.type) {
      input = document.createElement('select');
      input.disabled = field.readOnly;
      for (const opt of this.enums.type) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === currentValue) o.selected = true;
        input.appendChild(o);
      }
      input.addEventListener('change', () => this._markDirty(field.path, input.value));
      return input;
    }

    // Color hint → color picker
    if (field.hint === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.value = currentValue;
      input.disabled = field.readOnly;
      input.addEventListener('change', () => this._markDirty(field.path, input.value));
      return input;
    }

    // Long text → textarea
    if (field.hint === 'textarea') {
      input = document.createElement('textarea');
      input.value = currentValue;
      input.rows = 3;
      input.disabled = field.readOnly;
      input.addEventListener('change', () => this._markDirty(field.path, input.value));
      return input;
    }

    // Datetime → readonly display
    if (field.hint === 'datetime') {
      input = document.createElement('span');
      input.className = 'json-field-datetime';
      const d = new Date(currentValue);
      input.textContent = d.toLocaleString();
      return input;
    }

    // Default: text input
    input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.disabled = field.readOnly;
    input.addEventListener('change', () => this._markDirty(field.path, input.value));
    return input;
  }

  _getValueAtPath(path) {
    return path.split('.').reduce((curr, key) => curr?.[key], this.data);
  }

  _markDirty(fieldPath, newValue) {
    const oldValue = this._getValueAtPath(fieldPath);
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      this.dirty.delete(fieldPath);
    } else {
      this.dirty.set(fieldPath, newValue);
    }
    this._updateSaveButton();
  }

  _updateSaveButton() {
    const btn = this.container.querySelector('.json-editor-save');
    if (!btn) return;
    btn.textContent = `Save changes (${this.dirty.size})`;
    btn.disabled = this.dirty.size === 0;
  }

  async saveAll() {
    const statusEl = this.container.querySelector('.json-editor-status');
    const changes = Array.from(this.dirty.entries());
    statusEl.textContent = `Saving ${changes.length} change(s)...`;

    let successCount = 0;
    let errors = [];
    for (const [fieldPath, newValue] of changes) {
      try {
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: this.filePath,
            fieldPath,
            newValue,
            reason: 'edited via JsonEditor UI'
          })
        });
        successCount++;
      } catch (err) {
        errors.push(`${fieldPath}: ${err.message}`);
      }
    }

    if (errors.length === 0) {
      statusEl.textContent = `[OK] All ${successCount} change(s) saved.`;
      statusEl.className = 'json-editor-status success';
      this.dirty.clear();
      await this.load();
      this.render();
    } else {
      statusEl.textContent = `[PARTIAL] ${successCount} saved, ${errors.length} failed. ${errors.join('; ')}`;
      statusEl.className = 'json-editor-status error';
    }
  }

  cancelAll() {
    this.dirty.clear();
    this.render();
  }
}

window.JsonEditor = JsonEditor;
console.log('[OK] JsonEditor loaded');
