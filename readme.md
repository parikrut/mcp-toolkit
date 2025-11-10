# MCP Developer Toolkit

**Repo:** `github.com/parikrut/mcp-toolkit`

## What It Is
A Model Context Protocol (MCP) server that exposes developer productivity tools to Claude. Includes a reusable template for building custom MCP servers quickly.

## Why It Matters
- **MCP is Anthropic's protocol** — shows investment in their ecosystem
- Demonstrates understanding of **protocol-level AI infrastructure**
- Directly relevant to Anthropic's requirement: "Familiarity with MCP (Model Context Protocol)"
- Also relevant for Toyo: agent communication protocols

## What is MCP?
MCP (Model Context Protocol) is Anthropic's open standard for connecting AI assistants to external tools and data sources. It defines how:
- **Servers** expose tools, resources, and prompts
- **Clients** (like Claude Desktop) discover and use those capabilities
- Communication happens over JSON-RPC 2.0

## Core Features

### 1. Developer Tools Server
```typescript
// MCP server exposing dev productivity tools
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

const server = new Server({
  name: 'dev-tools',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
    resources: {},
  },
});

// Register tools
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'read_file',
      description: 'Read contents of a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    // ... more tools
  ],
}));
```

### 2. Tools to Implement

**File System Tools:**
```typescript
// read_file - Read file contents
{
  name: 'read_file',
  description: 'Read the contents of a file at the specified path',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      encoding: { type: 'string', default: 'utf-8' },
    },
    required: ['path'],
  },
}

// write_file - Write/create files
{
  name: 'write_file',
  description: 'Write content to a file, creating it if it doesn\'t exist',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
      createDirs: { type: 'boolean', default: true },
    },
    required: ['path', 'content'],
  },
}

// list_directory - List files in a directory
{
  name: 'list_directory',
  description: 'List files and directories at the specified path',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      recursive: { type: 'boolean', default: false },
      pattern: { type: 'string', description: 'Glob pattern to filter' },
    },
    required: ['path'],
  },
}
```

**Git Tools:**
```typescript
// git_status - Get repository status
{
  name: 'git_status',
  description: 'Get the current git status of a repository',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository path' },
    },
  },
}

// git_diff - Get diff of changes
{
  name: 'git_diff',
  description: 'Get diff of uncommitted changes or between commits',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      staged: { type: 'boolean', default: false },
      commit: { type: 'string', description: 'Compare against specific commit' },
    },
  },
}

// git_log - Get commit history
{
  name: 'git_log',
  description: 'Get recent commit history',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      limit: { type: 'number', default: 10 },
      oneline: { type: 'boolean', default: true },
    },
  },
}
```

**Shell Tools:**
```typescript
// run_command - Execute shell commands (sandboxed)
{
  name: 'run_command',
  description: 'Execute a shell command in the specified directory',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', default: 30000, description: 'Timeout in ms' },
    },
    required: ['command'],
  },
}
```

**Web Tools:**
```typescript
// web_search - Search the web
{
  name: 'web_search',
  description: 'Search the web using a search API',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', default: 5 },
    },
    required: ['query'],
  },
}

// fetch_url - Fetch webpage content
{
  name: 'fetch_url',
  description: 'Fetch and extract content from a URL',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      selector: { type: 'string', description: 'CSS selector to extract specific content' },
    },
    required: ['url'],
  },
}
```

### 3. Resources (Contextual Data)
```typescript
// Expose resources that Claude can read
server.setRequestHandler('resources/list', async () => ({
  resources: [
    {
      uri: 'file:///project/README.md',
      name: 'Project README',
      mimeType: 'text/markdown',
    },
    {
      uri: 'git:///project/status',
      name: 'Git Status',
      mimeType: 'text/plain',
    },
  ],
}));

server.setRequestHandler('resources/read', async (request) => {
  const { uri } = request.params;
  // Return resource content based on URI
});
```

### 4. Claude Desktop Integration
```json
// ~/.config/claude/claude_desktop_config.json (macOS/Linux)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "dev-tools": {
      "command": "node",
      "args": ["/path/to/mcp-toolkit/dist/index.js"],
      "env": {
        "ALLOWED_PATHS": "/home/user/projects",
        "ENABLE_SHELL": "true"
      }
    }
  }
}
```

### 5. Security Considerations
```typescript
// Implement path sandboxing
const ALLOWED_PATHS = process.env.ALLOWED_PATHS?.split(':') || [process.cwd()];

function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return ALLOWED_PATHS.some(allowed => resolved.startsWith(path.resolve(allowed)));
}

// Implement command allowlist for shell execution
const ALLOWED_COMMANDS = ['ls', 'cat', 'grep', 'find', 'git', 'npm', 'node'];

function isCommandAllowed(command: string): boolean {
  const binary = command.split(' ')[0];
  return ALLOWED_COMMANDS.includes(binary);
}
```

## Tech Stack
- **Language:** TypeScript
- **Runtime:** Node.js
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Additional:** simple-git (for git operations), node-fetch, cheerio (for web scraping)

## File Structure
```
mcp-toolkit/
├── src/
│   ├── index.ts              # Server entry point
│   ├── server.ts             # MCP server setup
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── filesystem.ts     # File operations
│   │   ├── git.ts            # Git operations
│   │   ├── shell.ts          # Command execution
│   │   └── web.ts            # Web search/fetch
│   ├── resources/
│   │   ├── index.ts          # Resource registry
│   │   └── project.ts        # Project context resources
│   └── utils/
│       ├── security.ts       # Path/command validation
│       └── config.ts         # Configuration loading
├── examples/
│   ├── claude-desktop-config.json
│   └── usage-examples.md
├── package.json
├── tsconfig.json
└── README.md
```

## MVP Scope (Build First)
1. **Core server setup** with MCP SDK
2. **File tools:** read_file, write_file, list_directory
3. **Git tools:** git_status, git_diff
4. **Security:** Path sandboxing
5. **Claude Desktop config** example
6. **README** with setup instructions

## Advanced Features (Later)
- Shell command execution with allowlist
- Web search integration
- Resource providers for project context
- Prompt templates for common workflows
- npm package for easy installation

## Example Usage

Once installed and configured with Claude Desktop:

**User:** "Read the README.md file and summarize the project"
**Claude:** *uses read_file tool* "This project is..."

**User:** "What files have I changed since my last commit?"
**Claude:** *uses git_status and git_diff tools* "You have 3 modified files..."

**User:** "Search for how to implement authentication in FastAPI"
**Claude:** *uses web_search tool* "Here are the top approaches..."

---
