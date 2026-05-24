# 🧠 SquidMind - Brain & Tools System

## Overview

SquidMind now supports **multi-model orchestration** with:
- ✅ **Claude API** (Haiku, Sonnet, Opus)
- ✅ **Local GGUF models** (Llama, Mistral, etc.)
- ✅ **Rich tool system** (filesystem, web, calculator, etc.)
- ✅ **Brain templates** (reusable agent configurations)

---

## 🧠 Brain System

A **Brain** is a complete intelligence profile that defines:
- **Identity**: Role, expertise, personality
- **Prompts**: System prompt, instruction templates
- **Model**: Which LLM to use (Claude or local GGUF)
- **Tools**: Available tools for this brain
- **Memory structure**: How knowledge is organized

### Brain Structure

```json
{
  "id": "brain_code_reviewer",
  "name": "Code Reviewer Pro",
  "identity": {
    "role": "Senior Code Reviewer",
    "expertise": ["Python", "JavaScript", "Security"],
    "personality": ["meticulous", "constructive"]
  },
  "prompts": {
    "system": "You are a senior code reviewer...",
    "instruction_templates": {
      "review_pr": "Review this PR: {diff}",
      "quick_check": "Quick check: {code}"
    }
  },
  "model": {
    "provider": "anthropic",  // or "local_gguf"
    "model_name": "claude-haiku-4-20250514",
    "model_path": null,  // For GGUF: "models/mistral-7b-q4.gguf"
    "parameters": {
      "temperature": 0.3,
      "max_tokens": 500
    }
  },
  "tools": {
    "enabled": ["read_file", "list_files", "web_search"],
    "disabled": ["delete_file"]
  }
}
```

### Using Brains

**1. Create an agent with a brain:**
```javascript
POST /api/agents
{
  "name": "My Code Reviewer",
  "brain_id": "brain_code_reviewer"
}
```

**2. The agent inherits:**
- System prompt from brain
- Tool access
- Model configuration
- Memory structure

**3. Execute:**
```javascript
POST /api/agents/:id/execute
{
  "input": "Review this code: function add(a,b){return a+b}"
}
```

---

## 📦 Local GGUF Models

### Setup

**1. Download a GGUF model:**
```bash
# Example: Download Mistral 7B Q4
wget https://huggingface.co/.../mistral-7b-instruct-v0.2.Q4_K_M.gguf

# Move to models directory
mv mistral-7b-instruct-v0.2.Q4_K_M.gguf squidmind/data/models/
```

**2. Create a brain with local model:**
```json
{
  "name": "Local Assistant",
  "model": {
    "provider": "local_gguf",
    "model_path": "mistral-7b-instruct-v0.2.Q4_K_M.gguf",
    "parameters": {
      "temperature": 0.7,
      "max_tokens": 500,
      "gpu_layers": 0  // 0 = CPU only, >0 = use GPU
    }
  }
}
```

**3. Load the model:**
```javascript
POST /api/models/load
{
  "modelPath": "mistral-7b-instruct-v0.2.Q4_K_M.gguf",
  "options": {
    "nGpuLayers": 0  // CPU only
  }
}
```

**4. Execute:**
Agent execution automatically uses the local model!

### Performance Tips

**CPU-only:**
- Use Q4 quantization (fastest)
- Expect 5-10 tokens/sec on modern CPUs

**With GPU (NVIDIA):**
```json
{
  "gpu_layers": 35  // Put 35 layers on GPU
}
```
- Expect 30-100 tokens/sec

---

## 🔧 Tools System

### Built-in Tools

**Filesystem:**
- `read_file` - Read file content
- `write_file` - Write to file
- `list_files` - List directory
- `delete_file` - Delete file

**Web:**
- `web_search` - Search with DuckDuckGo
- `web_fetch` - Fetch URL content

**Utilities:**
- `calculator` - Math expressions
- `get_datetime` - Current time
- `json_parse` - Parse JSON
- `json_stringify` - Stringify JSON

### Using Tools

**List available tools:**
```javascript
GET /api/tools
```

**Execute a tool:**
```javascript
POST /api/tools/execute
{
  "toolName": "calculator",
  "parameters": {
    "expression": "2 + 2 * 10"
  }
}
// Returns: { "success": true, "result": 22 }
```

**Agent with tools:**
```json
{
  "brain_id": "brain_data_analyst",
  "tools": {
    "enabled": ["read_file", "calculator", "web_search"]
  }
}
```

When agent executes, it can call these tools autonomously!

### Custom Tools

```javascript
const toolRegistry = require('./server/services/ToolRegistry');

toolRegistry.registerTool({
  name: 'send_email',
  description: 'Send an email',
  parameters: {
    to: { type: 'string', required: true },
    subject: { type: 'string', required: true },
    body: { type: 'string', required: true }
  },
  execute: async ({ to, subject, body }) => {
    // Your email logic
    return { success: true, message: 'Email sent' };
  }
});
```

---

## 📊 Example Brains

### 1. Code Reviewer

**File:** `data/brains/brain_code_reviewer.json`

**Specialization:**
- Reviews code for bugs, security, style
- Uses: `read_file`, `list_files`, `web_search`
- Model: Haiku (fast, cheap)
- Temperature: 0.3 (precise)

**Use case:**
```javascript
POST /api/agents/:id/execute
{
  "input": "Review the file server/index.js"
}
```

### 2. Data Analyst

**File:** `data/brains/brain_data_analyst.json`

**Specialization:**
- Analyzes datasets
- Cleans messy data
- Finds patterns
- Uses: `read_file`, `calculator`, `json_parse`
- Model: Haiku
- Temperature: 0.2 (factual)

**Use case:**
```javascript
POST /api/agents/:id/execute
{
  "input": "Analyze sales_data.json and find trends"
}
```

---

## 🚀 Quick Start

### 1. Create a Brain-Powered Agent

```bash
# 1. List available brains
curl http://localhost:3000/api/brains

# 2. Create agent with brain
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Reviewer",
    "brain_id": "brain_code_reviewer"
  }'

# 3. Execute
curl -X POST http://localhost:3000/api/agents/squid_123/execute \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Review this: function add(a,b){return a+b}"
  }'
```

### 2. Use Local GGUF Model

```bash
# 1. Download model (example)
cd squidmind/data/models
wget https://huggingface.co/.../mistral-7b.Q4.gguf

# 2. Create brain with local model
curl -X POST http://localhost:3000/api/brains \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Local Assistant",
    "model": {
      "provider": "local_gguf",
      "model_path": "mistral-7b.Q4.gguf",
      "parameters": {
        "temperature": 0.7,
        "max_tokens": 500
      }
    }
  }'

# 3. Create agent
curl -X POST http://localhost:3000/api/agents \
  -d '{"name": "Local Agent", "brain_id": "brain_..."}'

# 4. Execute (uses local model!)
curl -X POST http://localhost:3000/api/agents/squid_123/execute \
  -d '{"input": "Hello!"}'
```

---

## 📁 File Structure

```
squidmind/
├── data/
│   ├── brains/
│   │   ├── brain_code_reviewer.json
│   │   └── brain_data_analyst.json
│   ├── models/
│   │   └── mistral-7b.Q4.gguf  (your GGUF models)
│   ├── agents/
│   └── logs/
│
├── server/
│   ├── models/
│   │   ├── Agent.js
│   │   └── Brain.js  ← NEW
│   └── services/
│       ├── UnifiedOrchestrator.js  ← NEW
│       ├── ModelManager.js  ← NEW (GGUF)
│       └── ToolRegistry.js  ← NEW (Tools)
```

---

## 🔄 Workflow

```
1. Create Brain
   ↓
2. Create Agent (references Brain)
   ↓
3. Execute Agent
   ↓
4. UnifiedOrchestrator decides:
   - Use Claude API? → Call Anthropic
   - Use local GGUF? → Load model, run inference
   ↓
5. Agent can use Tools during execution
   ↓
6. Results saved to Agent memory (KANBAN)
```

---

## 💡 Best Practices

**When to use Claude API:**
- Complex reasoning tasks
- Need extended thinking
- High-quality output required

**When to use local GGUF:**
- Privacy-sensitive data
- Offline operation
- Cost optimization (free after download)
- High-volume simple tasks

**Tool Safety:**
- Only enable tools the brain needs
- Disable `delete_file` unless necessary
- Validate tool outputs

**Brain Design:**
- Keep prompts concise (max 500 tokens response)
- Use instruction templates for reusability
- Set temperature low (0.2-0.3) for factual tasks
- Set temperature high (0.7-0.9) for creative tasks

---

## 🎯 Next Steps

1. **Create custom brains** for your use cases
2. **Download GGUF models** for local inference
3. **Add custom tools** for your workflow
4. **Combine**: Brain + Tools + Local Model = Powerful autonomous agent!

---

**Happy Brain Building!** 🧠🦑✨
