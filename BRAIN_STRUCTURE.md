# SquidMind Agent Brain Structure & Tool Calling

## 🧠 agents.json Structure

### Complete Agent Definition

```json
{
  "agents": [
    {
      "id": "bob_dev_001",
      "name": "Bob",
      "specialty": "Full-Stack Developer",
      "role": "developer",
      
      "brain": {
        "model": "claude-sonnet-4-20250514",
        "temperature": 0.7,
        "max_tokens": 4096,
        
        "system_prompt": "You are Bob, a senior full-stack developer specializing in React and Python. You write clean, maintainable code with comprehensive tests. You always explain your decisions and suggest improvements.",
        
        "personality": {
          "traits": ["analytical", "detail-oriented", "helpful"],
          "communication_style": "professional",
          "code_style": "clean_code_advocate"
        },
        
        "available_tools": [
          "code_interpreter",
          "file_operations",
          "git_operations",
          "web_search",
          "database_query"
        ],
        
        "tool_config": {
          "code_interpreter": {
            "languages": ["python", "javascript", "typescript"],
            "max_execution_time": 30,
            "sandbox": true
          },
          "file_operations": {
            "allowed_paths": ["/project", "/output"],
            "max_file_size": "10MB"
          },
          "git_operations": {
            "auto_commit": false,
            "branch_protection": true
          }
        },
        
        "memory": {
          "conversation_history": 20,
          "context_window": 200000,
          "remember_across_sessions": true
        }
      },
      
      "stats": {
        "level": 5,
        "xp": 2450,
        "xpToNext": 3000,
        "tasksCompleted": 47,
        "successRate": 0.94
      },
      
      "appearance": {
        "color": 180,
        "outfit": "hoodie",
        "accessories": ["glasses", "headphones"]
      },
      
      "state": {
        "status": "working",
        "current_thought": "Optimizing database queries...",
        "energy": 75,
        "currentProject": "BRAIN",
        "currentTask": "task_123"
      }
    }
  ]
}
```

---

## 🛠️ Tool Calling System

### How Agents Call Tools

```python
# Backend: agent_controller.py

class AgentController:
    def __init__(self, agent_config):
        self.agent = agent_config
        self.tools = self.load_tools(agent_config['brain']['available_tools'])
    
    async def run_task(self, task_description):
        """
        Execute a task using Claude API with tool use
        """
        
        # 1. Prepare tools for Claude API
        tools_def = self.prepare_tools_for_claude()
        
        # 2. Call Claude with tools
        response = await anthropic.messages.create(
            model=self.agent['brain']['model'],
            max_tokens=self.agent['brain']['max_tokens'],
            system=self.agent['brain']['system_prompt'],
            messages=[
                {
                    "role": "user",
                    "content": task_description
                }
            ],
            tools=tools_def,
            tool_choice={"type": "auto"}
        )
        
        # 3. Process tool calls
        while response.stop_reason == "tool_use":
            tool_results = []
            
            for block in response.content:
                if block.type == "tool_use":
                    # Execute tool
                    result = await self.execute_tool(
                        block.name,
                        block.input
                    )
                    
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result
                    })
            
            # 4. Continue conversation with tool results
            response = await anthropic.messages.create(
                model=self.agent['brain']['model'],
                max_tokens=self.agent['brain']['max_tokens'],
                messages=[
                    {"role": "user", "content": task_description},
                    {"role": "assistant", "content": response.content},
                    {"role": "user", "content": tool_results}
                ],
                tools=tools_def
            )
        
        # 5. Return final response
        return response.content[0].text
    
    def prepare_tools_for_claude(self):
        """Convert our tools to Claude API format"""
        tools = []
        
        for tool_name in self.agent['brain']['available_tools']:
            if tool_name == "code_interpreter":
                tools.append({
                    "name": "execute_code",
                    "description": "Execute Python or JavaScript code in a sandboxed environment",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "language": {
                                "type": "string",
                                "enum": ["python", "javascript"],
                                "description": "Programming language"
                            },
                            "code": {
                                "type": "string",
                                "description": "Code to execute"
                            }
                        },
                        "required": ["language", "code"]
                    }
                })
            
            elif tool_name == "file_operations":
                tools.append({
                    "name": "read_file",
                    "description": "Read contents of a file",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "File path"
                            }
                        },
                        "required": ["path"]
                    }
                })
                
                tools.append({
                    "name": "write_file",
                    "description": "Write content to a file",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "content": {"type": "string"}
                        },
                        "required": ["path", "content"]
                    }
                })
            
            elif tool_name == "git_operations":
                tools.append({
                    "name": "git_commit",
                    "description": "Commit changes to git",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "files": {
                                "type": "array",
                                "items": {"type": "string"}
                            }
                        },
                        "required": ["message"]
                    }
                })
            
            # Add more tools...
        
        return tools
    
    async def execute_tool(self, tool_name, tool_input):
        """Execute a tool and return result"""
        
        if tool_name == "execute_code":
            return await self.run_code(
                tool_input['language'],
                tool_input['code']
            )
        
        elif tool_name == "read_file":
            return await self.read_file(tool_input['path'])
        
        elif tool_name == "write_file":
            return await self.write_file(
                tool_input['path'],
                tool_input['content']
            )
        
        elif tool_name == "git_commit":
            return await self.git_commit(
                tool_input['message'],
                tool_input.get('files', [])
            )
        
        # Add more tool implementations...
        
        else:
            return {"error": f"Unknown tool: {tool_name}"}
```

---

## 🔄 Complete Task Workflow

```
1. USER ASSIGNS TASK
   ↓
2. TASK ADDED TO project_memory.json
   {
     "id": "task_123",
     "description": "Add user authentication",
     "status": "pending",
     "assignedTo": "bob_dev_001"
   }
   ↓
3. AGENT PICKS UP TASK
   - Reads project_memory.json
   - Sees assigned task
   - Changes status to "working"
   ↓
4. AGENT THINKS (Claude API Call #1)
   USER: "Add user authentication to the app"
   
   CLAUDE: I'll need to:
   1. Read existing code
   2. Design auth system
   3. Implement login/signup
   4. Write tests
   
   Let me start by reading the current code structure.
   [TOOL USE: read_file("project/app.py")]
   ↓
5. TOOL EXECUTION
   - SquidMind backend executes read_file
   - Returns file contents
   ↓
6. AGENT CONTINUES (Claude API Call #2)
   [TOOL RESULT: "from flask import Flask..."]
   
   CLAUDE: I can see this is a Flask app. I'll add Flask-Login.
   [TOOL USE: execute_code("python", "pip install flask-login")]
   ↓
7. CODE EXECUTION
   - Backend runs code in sandbox
   - Returns output
   ↓
8. AGENT WRITES CODE (Claude API Call #3)
   [TOOL RESULT: "Successfully installed flask-login"]
   
   CLAUDE: Now I'll create the authentication module.
   [TOOL USE: write_file("project/auth.py", "from flask_login import...")]
   ↓
9. FILE CREATED
   - Backend writes file to output folder
   - File listed in project_memory.json outputs
   ↓
10. AGENT COMMITS (Claude API Call #4)
    CLAUDE: Authentication implemented. Committing changes.
    [TOOL USE: git_commit("Add user authentication", ["auth.py", "app.py"])]
    ↓
11. TASK COMPLETE
    - Agent updates project_memory.json
    - status: "complete"
    - output_files: ["auth.py", "tests/test_auth.py"]
    - Agent status: "idle"
```

---

## 📊 project_memory.json Integration

```json
{
  "project": "BRAIN",
  "vision": "AI agent collaboration platform",
  
  "tasks": [
    {
      "id": "task_123",
      "description": "Add user authentication",
      "status": "complete",
      "assignedTo": "bob_dev_001",
      "priority": "high",
      "created": "2025-05-24T10:00:00Z",
      "completed": "2025-05-24T11:30:00Z",
      "output_files": [
        "/output/auth.py",
        "/output/tests/test_auth.py"
      ],
      "notes": "Implemented Flask-Login with email/password auth"
    },
    {
      "id": "task_124",
      "description": "Design landing page",
      "status": "working",
      "assignedTo": "alice_design_001",
      "priority": "medium",
      "created": "2025-05-24T11:00:00Z"
    }
  ],
  
  "progress": {
    "completion": "45%",
    "blockers": [],
    "next_steps": [
      "Add OAuth integration",
      "Create admin panel"
    ]
  },
  
  "agents_communication": [
    {
      "from": "bob_dev_001",
      "to": "alice_design_001",
      "message": "Auth is ready, you can design the login UI now",
      "timestamp": "2025-05-24T11:30:00Z"
    }
  ]
}
```

---

## 🚀 Available Tools by Category

### Code Execution
- **execute_code**: Run Python/JS in sandbox
- **install_package**: Install dependencies
- **run_tests**: Execute test suite

### File Operations
- **read_file**: Read file contents
- **write_file**: Write to file
- **list_files**: List directory contents
- **delete_file**: Remove file

### Git Operations
- **git_commit**: Commit changes
- **git_push**: Push to remote
- **git_branch**: Create/switch branch
- **git_status**: Check repo status

### Web & Data
- **web_search**: Search internet
- **web_scrape**: Extract web data
- **api_call**: HTTP requests
- **database_query**: SQL queries

### AI & Analysis
- **image_generation**: Create images
- **code_review**: Analyze code quality
- **security_scan**: Check vulnerabilities
- **performance_analysis**: Profile code

---

## 🔐 Security & Permissions

```json
{
  "tool_permissions": {
    "file_operations": {
      "allowed_paths": ["/project", "/output"],
      "forbidden_paths": ["/system", "/config"],
      "max_file_size": "10MB"
    },
    "code_execution": {
      "timeout": 30,
      "max_memory": "512MB",
      "network_access": false,
      "allowed_imports": ["standard_library", "approved_packages"]
    },
    "git_operations": {
      "auto_push": false,
      "require_review": true,
      "protected_branches": ["main", "production"]
    }
  }
}
```

---

## 📈 Monitoring & Logging

Every tool call is logged:

```json
{
  "log_entry": {
    "timestamp": "2025-05-24T11:15:23Z",
    "agent_id": "bob_dev_001",
    "tool": "write_file",
    "input": {
      "path": "/output/auth.py",
      "content_length": 1247
    },
    "result": "success",
    "execution_time_ms": 45
  }
}
```

This enables:
- ✅ Audit trail
- ✅ Performance monitoring
- ✅ Error debugging
- ✅ Cost tracking

---

**PRODUCTION READY BRAIN SYSTEM! 🧠✨**
