const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { evaluate } = require('mathjs');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.registerBuiltinTools();
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
      description: 'Search the web using DuckDuckGo',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query' },
        max_results: { type: 'number', required: false, description: 'Max results (default: 5)' }
      },
      execute: async ({ query, max_results = 5 }) => {
        try {
          // Simple DuckDuckGo HTML scraping (for demo - use proper API in production)
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          
          const $ = cheerio.load(response.data);
          const results = [];
          
          $('.result').slice(0, max_results).each((i, elem) => {
            const title = $(elem).find('.result__title').text().trim();
            const snippet = $(elem).find('.result__snippet').text().trim();
            const url = $(elem).find('.result__url').text().trim();
            
            if (title) {
              results.push({ title, snippet, url });
            }
          });
          
          return { success: true, results };
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

    console.log(`✅ Registered ${this.tools.size} built-in tools`);
  }

  /**
   * Register a custom tool
   */
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
