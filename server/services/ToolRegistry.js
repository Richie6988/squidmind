const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { evaluate } = require('mathjs');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    // Initialize filesystem tools
    const filesystemTools = require('./FilesystemTools');
    await filesystemTools.init();
    
    // Register all tools
    this.registerBuiltinTools();
    
    this.initialized = true;
  }

  /**
   * Register all built-in tools
   */
  registerBuiltinTools() {
    // Filesystem tools
    this.registerTool({
      name: 'read_file',
      description: 'Read content from a file',
      parameters: {
        path: { type: 'string', required: true, description: 'File path to read' }
      },
      execute: async ({ path: filePath }) => {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          return { success: true, content };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        path: { type: 'string', required: true, description: 'File path to write' },
        content: { type: 'string', required: true, description: 'Content to write' }
      },
      execute: async ({ path: filePath, content }) => {
        try {
          await fs.writeFile(filePath, content, 'utf8');
          return { success: true, message: `File written: ${filePath}` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'list_files',
      description: 'List files in a directory',
      parameters: {
        path: { type: 'string', required: true, description: 'Directory path' },
        recursive: { type: 'boolean', required: false, description: 'Recursive listing' }
      },
      execute: async ({ path: dirPath, recursive = false }) => {
        try {
          const files = await fs.readdir(dirPath, { withFileTypes: recursive });
          return { 
            success: true, 
            files: files.map(f => f.isDirectory ? f : f.name) 
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'delete_file',
      description: 'Delete a file',
      parameters: {
        path: { type: 'string', required: true, description: 'File path to delete' }
      },
      execute: async ({ path: filePath }) => {
        try {
          await fs.unlink(filePath);
          return { success: true, message: `File deleted: ${filePath}` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    // Web tools
    this.registerTool({
      name: 'web_search',
      description: 'Search the web using Brave Search API',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query' },
        count: { type: 'number', required: false, description: 'Number of results (default: 5, max: 20)' },
        freshness: { type: 'string', required: false, description: 'Time filter: day, week, month, year' }
      },
      execute: async ({ query, count = 5, freshness = null }) => {
        try {
          const braveApiKey = process.env.BRAVE_API_KEY;
          
          // If Brave API key exists, use it (better results)
          if (braveApiKey) {
            const params = new URLSearchParams({
              q: query,
              count: Math.min(count, 20)
            });
            
            if (freshness) {
              params.append('freshness', freshness);
            }
            
            const response = await axios.get(`https://api.search.brave.com/res/v1/web/search?${params}`, {
              headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': braveApiKey
              }
            });
            
            const results = response.data.web?.results || [];
            return {
              success: true,
              provider: 'brave',
              results: results.map(r => ({
                title: r.title,
                url: r.url,
                description: r.description,
                age: r.age
              }))
            };
          }
          
          // Fallback to DuckDuckGo HTML scraping
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          
          const $ = cheerio.load(response.data);
          const results = [];
          
          $('.result').slice(0, count).each((i, elem) => {
            const title = $(elem).find('.result__title').text().trim();
            const snippet = $(elem).find('.result__snippet').text().trim();
            const url = $(elem).find('.result__url').text().trim();
            
            if (title) {
              results.push({ 
                title, 
                description: snippet, 
                url 
              });
            }
          });
          
          return { 
            success: true,
            provider: 'duckduckgo',
            results 
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'web_fetch',
      description: 'Fetch content from a URL',
      parameters: {
        url: { type: 'string', required: true, description: 'URL to fetch' }
      },
      execute: async ({ url }) => {
        try {
          const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
          });
          
          const $ = cheerio.load(response.data);
          
          // Extract text content
          const title = $('title').text();
          const text = $('body').text().replace(/\s+/g, ' ').trim();
          
          return { 
            success: true, 
            url,
            title,
            content: text.substring(0, 5000), // Limit to 5k chars
            status: response.status
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    // Calculator tool
    this.registerTool({
      name: 'calculator',
      description: 'Evaluate mathematical expressions',
      parameters: {
        expression: { type: 'string', required: true, description: 'Math expression to evaluate' }
      },
      execute: async ({ expression }) => {
        try {
          const result = evaluate(expression);
          return { success: true, result, expression };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    // Time/Date tool
    this.registerTool({
      name: 'get_datetime',
      description: 'Get current date and time',
      parameters: {
        timezone: { type: 'string', required: false, description: 'Timezone (default: UTC)' }
      },
      execute: async ({ timezone = 'UTC' }) => {
        const now = new Date();
        return {
          success: true,
          datetime: now.toISOString(),
          timestamp: now.getTime(),
          timezone,
          formatted: now.toLocaleString('en-US', { timeZone: timezone })
        };
      }
    });

    // JSON tools
    this.registerTool({
      name: 'json_parse',
      description: 'Parse JSON string',
      parameters: {
        json_string: { type: 'string', required: true, description: 'JSON string to parse' }
      },
      execute: async ({ json_string }) => {
        try {
          const parsed = JSON.parse(json_string);
          return { success: true, data: parsed };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'json_stringify',
      description: 'Convert object to JSON string',
      parameters: {
        data: { type: 'object', required: true, description: 'Data to stringify' }
      },
      execute: async ({ data }) => {
        try {
          const json = JSON.stringify(data, null, 2);
          return { success: true, json };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    // Advanced Filesystem Tools
    const filesystemTools = require('./FilesystemTools');
    
    this.registerTool({
      name: 'create_directory',
      description: 'Create directory with parent directories',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', required: true, description: 'Directory path to create' }
      },
      execute: async ({ path }) => filesystemTools.createDirectory(path)
    });

    this.registerTool({
      name: 'directory_tree',
      description: 'Get recursive directory tree structure',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', required: false, description: 'Directory path (default: workspace root)' },
        excludePatterns: { type: 'array', required: false, description: 'Patterns to exclude' }
      },
      execute: async ({ path = '.', excludePatterns = [] }) => filesystemTools.directoryTree(path, excludePatterns)
    });

    this.registerTool({
      name: 'search_files',
      description: 'Search files by pattern (glob-style)',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', required: false, description: 'Search root (default: workspace)' },
        pattern: { type: 'string', required: true, description: 'Pattern (e.g., *.tsx, **/*.json)' }
      },
      execute: async ({ path = '.', pattern }) => filesystemTools.searchFiles(path, pattern)
    });

    this.registerTool({
      name: 'get_file_info',
      description: 'Get file metadata (size, dates, permissions)',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', required: true, description: 'File or directory path' }
      },
      execute: async ({ path }) => filesystemTools.getFileInfo(path)
    });

    this.registerTool({
      name: 'move_file',
      description: 'Move or rename file/directory',
      category: 'filesystem',
      parameters: {
        source: { type: 'string', required: true, description: 'Source path' },
        destination: { type: 'string', required: true, description: 'Destination path' }
      },
      execute: async ({ source, destination }) => filesystemTools.moveFile(source, destination)
    });

    this.registerTool({
      name: 'run_javascript',
      description: 'Execute JavaScript code in sandbox (timeout: 60s max)',
      category: 'code',
      parameters: {
        code: { type: 'string', required: true, description: 'JavaScript code to execute' },
        timeout_seconds: { type: 'number', required: false, description: 'Timeout in seconds (default: 5)' }
      },
      execute: async ({ code, timeout_seconds = 5 }) => filesystemTools.runJavaScript(code, timeout_seconds)
    });

    this.registerTool({
      name: 'read_media_file',
      description: 'Read image/audio file as base64',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', required: true, description: 'Media file path' }
      },
      execute: async ({ path }) => filesystemTools.readMediaFile(path)
    });

    // HuggingFace AI Tools
    const hfInference = require('./HuggingFaceInference');
    
    this.registerTool({
      name: 'hf_search_models',
      description: 'Search HuggingFace models',
      category: 'ai',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query' },
        task: { type: 'string', required: false, description: 'Filter by task (text-generation, etc.)' },
        limit: { type: 'number', required: false, description: 'Number of results (default: 20)' }
      },
      execute: async ({ query, task = 'text-generation', limit = 20 }) => {
        return await hfInference.searchModels(query, { task, limit });
      }
    });

    this.registerTool({
      name: 'hf_generate',
      description: 'Generate text with HuggingFace Inference API',
      category: 'ai',
      parameters: {
        model: { type: 'string', required: true, description: 'Model ID (e.g., mistralai/Mistral-7B-Instruct-v0.2)' },
        input: { type: 'string', required: true, description: 'Input prompt' },
        max_tokens: { type: 'number', required: false, description: 'Max tokens (default: 500)' },
        temperature: { type: 'number', required: false, description: 'Temperature (default: 0.7)' }
      },
      execute: async ({ model, input, max_tokens = 500, temperature = 0.7 }) => {
        try {
          const result = await hfInference.generateText(model, input, {
            max_new_tokens: max_tokens,
            temperature
          });
          return { success: true, output: result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'hf_generate_code',
      description: 'Generate code with HuggingFace models',
      category: 'ai',
      parameters: {
        prompt: { type: 'string', required: true, description: 'Code generation prompt' },
        language: { type: 'string', required: false, description: 'Programming language (default: python)' },
        max_tokens: { type: 'number', required: false, description: 'Max tokens (default: 1000)' }
      },
      execute: async ({ prompt, language = 'python', max_tokens = 1000 }) => {
        try {
          const result = await hfInference.generateCode(prompt, language, { max_tokens });
          return { success: true, code: result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    // Local Model Scanner Tools
    const localModelScanner = require('./LocalModelScanner');
    
    this.registerTool({
      name: 'scan_local_models',
      description: 'Scan PC for GGUF/GGML models (HF cache, Ollama, LM Studio, etc.)',
      category: 'ai',
      parameters: {},
      execute: async () => {
        try {
          const models = await localModelScanner.scanSystem();
          return { 
            success: true, 
            models, 
            count: models.length,
            stats: localModelScanner.getStats()
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'find_local_model',
      description: 'Search for specific model by name',
      category: 'ai',
      parameters: {
        searchTerm: { type: 'string', required: true, description: 'Model name or partial match' }
      },
      execute: async ({ searchTerm }) => {
        try {
          const models = await localModelScanner.findModel(searchTerm);
          return { success: true, models, count: models.length };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'get_model_stats',
      description: 'Get statistics about local models',
      category: 'ai',
      parameters: {},
      execute: async () => {
        try {
          const stats = localModelScanner.getStats();
          return { success: true, stats };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    console.log(`✅ Registered ${this.tools.size} built-in tools`);
  }

  /**
   * Register a custom tool
   */
  /**
   * Mirror all in-memory tools into data/tools/tool_registry.json so the
   * V2 AgentForm "Tools Allowed" dropdown shows them.
   */
  async syncToRegistryFile(sharedRm) {
    if (!sharedRm) return;
    try {
      sharedRm.invalidateCache();
      const registry = await sharedRm.read('tools/tool_registry.json').catch(() => ({
        schema_version: '2.0.0',
        schema_type: 'tool_registry',
        metadata: { last_id_used: 0, next_id: 1, id_format: 'tool_NNN', total_available: 0, last_updated_at: new Date().toISOString() },
        tools: {}
      }));
      
      registry.tools = registry.tools || {};
      let nextId = registry.metadata?.next_id || 1;
      let added = 0;
      
      for (const [name, tool] of this.tools.entries()) {
        // Check if already in registry by name
        const exists = Object.values(registry.tools).find(t => t.name === name);
        if (exists) continue;
        
        const toolId = `tool_local_${String(nextId).padStart(3, '0')}`;
        registry.tools[toolId] = {
          tool_id: toolId,
          name: name,
          type: 'local_function',
          category: tool.category || 'general',
          description: tool.description || '',
          parameters: tool.parameters || {},
          available: true,
          registered_at: new Date().toISOString()
        };
        nextId++;
        added++;
      }
      
      if (added > 0) {
        registry.metadata.next_id = nextId;
        registry.metadata.last_id_used = nextId - 1;
        registry.metadata.total_available = Object.keys(registry.tools).length;
        await sharedRm.write('tools/tool_registry.json', registry);
        console.log(`[ToolRegistry] Synced ${added} built-in tools to V2 registry (total: ${registry.metadata.total_available})`);
      }
    } catch (err) {
      console.warn('[ToolRegistry] syncToRegistryFile failed:', err.message);
    }
  }

  registerTool(tool) {
    if (!tool.name || !tool.execute) {
      throw new Error('Tool must have name and execute function');
    }

    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || {},
      execute: tool.execute,
      category: tool.category || 'custom'
    });
  }

  /**
   * Execute a tool
   */
  async executeTool(toolName, parameters = {}) {
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      return { 
        success: false, 
        error: `Tool '${toolName}' not found` 
      };
    }

    try {
      console.log(`🔧 Executing tool: ${toolName}`);
      const result = await tool.execute(parameters);
      return result;
    } catch (error) {
      console.error(`Tool execution error (${toolName}):`, error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get tool definition (for LLM)
   */
  getToolDefinition(toolName) {
    const tool = this.tools.get(toolName);
    if (!tool) return null;

    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    };
  }

  /**
   * Get all tool definitions
   */
  getAllToolDefinitions() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      category: tool.category
    }));
  }

  /**
   * List available tools
   */
  listTools(category = null) {
    const tools = Array.from(this.tools.values());
    
    if (category) {
      return tools.filter(t => t.category === category);
    }
    
    return tools;
  }

  /**
   * Remove a tool
   */
  unregisterTool(toolName) {
    return this.tools.delete(toolName);
  }
}

// Singleton instance
const toolRegistry = new ToolRegistry();

module.exports = toolRegistry;
