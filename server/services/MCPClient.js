'use strict';

/**
 * MCPClient — minimal Model Context Protocol client.
 *
 * MCP is Anthropic's open standard for connecting LLMs to external tools
 * (databases, APIs, services). This implementation focuses on the
 * HTTP-transport flavour — it doesn't require the @modelcontextprotocol/sdk
 * npm package. Stdio-transport servers (the more common flavour for local
 * dev) are stubbed with a TODO — hook up via child_process spawn when we
 * add the SDK dep.
 *
 * Config lives at aquarium/CHANNELS/mcp_servers.json:
 *   {
 *     "servers": {
 *       "postgres_readonly": {
 *         "transport": "http",
 *         "url":       "https://mcp.example.com/postgres",
 *         "headers":   { "Authorization": "Bearer …" },
 *         "enabled":   true,
 *         "description": "Read-only Postgres for analytics"
 *       }
 *     }
 *   }
 *
 * Two Poseidon tools use this:
 *   - list_mcp_servers()                  → registry snapshot
 *   - call_mcp_tool(server, name, args)   → JSON-RPC over HTTP → tool result
 *
 * Poseidon can discover the tools a server exposes by first calling
 * call_mcp_tool(server, 'tools/list', {}) — that's a standard MCP method.
 */

const log = {
  info: (...a) => console.log('[MCPClient]', ...a),
  warn: (...a) => console.warn('[MCPClient]', ...a),
};

class MCPClient {
  constructor(rm) {
    this.rm = rm;
    this._nextRpcId = 1;
  }

  async loadServers() {
    try {
      this.rm.invalidateCache();
      const cfg = await this.rm.read('CHANNELS/mcp_servers.json').catch(() => null);
      return cfg?.servers || {};
    } catch { return {}; }
  }

  async listServers() {
    const servers = await this.loadServers();
    return Object.entries(servers).map(([name, s]) => ({
      name,
      transport:   s.transport || 'http',
      url:         s.url || null,
      enabled:     s.enabled !== false,
      description: s.description || '',
    }));
  }

  /**
   * JSON-RPC 2.0 call to an HTTP MCP server. Returns { ok, result?, error? }.
   * MCP standard methods worth knowing:
   *   - tools/list  → { tools: [ { name, description, inputSchema } ] }
   *   - tools/call  → args: { name, arguments } → { content: [ { type, text } ] }
   *   - resources/list, resources/read, prompts/list, prompts/get
   */
  async call(serverName, method, params = {}) {
    const servers = await this.loadServers();
    const server = servers[serverName];
    if (!server) return { ok: false, error: `MCP server "${serverName}" not registered` };
    if (server.enabled === false) return { ok: false, error: `MCP server "${serverName}" is disabled` };

    if (server.transport === 'stdio') {
      // TODO: hook up @modelcontextprotocol/sdk when we take the dep, so we
      // can spawn a subprocess and speak JSON-RPC over its stdin/stdout.
      return { ok: false, error: `stdio transport not yet implemented for "${serverName}"` };
    }

    if (!server.url) return { ok: false, error: `MCP server "${serverName}" has no url` };

    const rpcId = this._nextRpcId++;
    const body  = JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params });
    try {
      const resp = await fetch(server.url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          ...(server.headers || {}),
        },
        body,
        signal:  AbortSignal.timeout(server.timeout_ms || 30_000),
      });
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await resp.text();
        return { ok: false, error: `MCP server returned non-JSON: ${text.slice(0, 200)}` };
      }
      const data = await resp.json();
      if (data.error) return { ok: false, error: data.error.message || JSON.stringify(data.error), code: data.error.code };
      return { ok: true, result: data.result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Convenience: list tools exposed by a server.
   * Wraps call(server, 'tools/list', {}).
   */
  async listTools(serverName) {
    const r = await this.call(serverName, 'tools/list', {});
    if (!r.ok) return r;
    return { ok: true, tools: r.result?.tools || [] };
  }

  /**
   * Convenience: invoke a tool on a server.
   * Wraps call(server, 'tools/call', { name, arguments }).
   */
  async callTool(serverName, toolName, args = {}) {
    const r = await this.call(serverName, 'tools/call', { name: toolName, arguments: args });
    if (!r.ok) return r;
    // MCP tools return { content: [ { type: 'text'|'image'|…, text?, data? } ] }
    const content = r.result?.content || [];
    const textParts = content.filter(c => c.type === 'text').map(c => c.text || '');
    return {
      ok:      true,
      content,
      summary: textParts.join('\n').slice(0, 2000),
      isError: !!r.result?.isError,
    };
  }
}

module.exports = { MCPClient };
