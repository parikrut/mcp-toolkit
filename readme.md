# Dev Skills MCP Server

An [MCP](https://modelcontextprotocol.io/) server that gives AI assistants **specialized development expertise**. Instead of generic coding help, it provides opinionated, battle-tested playbooks for building microservices, frontends, databases, DevOps pipelines, and more.

Works with **VS Code Copilot (Agent Mode)**, **Claude Desktop**, **Cursor**, and any MCP-compatible client.

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Git**
- An MCP-compatible client (VS Code 1.99+, Claude Desktop, Cursor, etc.)

### 1. Clone & Install

```bash
git clone https://github.com/parikrut/mcp-toolkit.git
cd mcp-toolkit
npm install
```

### 2. Build

```bash
npm run build
```

This compiles TypeScript into `dist/`.

### 3. Connect to Your AI Client

Pick the client you use and follow the steps below.

---

## Setup — VS Code (GitHub Copilot)

> Requires **VS Code 1.99+** with GitHub Copilot extension.

**Option A — Open this repo directly:**

The repo already includes `.vscode/mcp.json`. Just open the folder in VS Code:

```bash
code mcp-toolkit
```

Copilot will auto-discover the server. Switch to **Agent mode** in the Copilot chat panel and you'll see the dev-skills tools available.

**Option B — Add to another project:**

Create `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "dev-skills": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-toolkit/dist/index.js"],
      "env": {
        "SKILLS_DIR": "/absolute/path/to/mcp-toolkit/src/skills"
      }
    }
  }
}
```

Replace `/absolute/path/to/mcp-toolkit` with the actual path where you cloned the repo.

> **Tip:** Use `${workspaceFolder}` if the MCP toolkit is inside your project.

---

## Setup — Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "dev-skills": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-toolkit/dist/index.js"],
      "env": {
        "SKILLS_DIR": "/absolute/path/to/mcp-toolkit/src/skills"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Setup — Cursor

Open **Settings → MCP Servers → Add Server** and enter:

| Field | Value |
|-------|-------|
| Name | `dev-skills` |
| Command | `node` |
| Args | `/absolute/path/to/mcp-toolkit/dist/index.js` |
| Env | `SKILLS_DIR=/absolute/path/to/mcp-toolkit/src/skills` |

---

## Verify It Works

After connecting, ask your AI assistant:

```
List all available dev skills
```

You should see 7 categories and 60 skills returned via the `list_skills` tool.

You can also test from the terminal:

```bash
# Interactive inspector (opens a web UI)
npm run inspect

# Or pipe JSON-RPC directly
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}\n' | node dist/index.js 2>/dev/null
```

---

## The Problem

AI assistants know general coding — but they don't know **your team's way of building things**. Every team has specific patterns, conventions, and standards that get lost in onboarding docs nobody reads.

## The Solution

Package your development expertise as **skills** (Markdown files) that any AI assistant can read and follow at runtime:

```
Developer: "Create a new user authentication microservice"

AI + MCP Server:
  1. Reads your microservice skill → learns YOUR patterns
  2. Reads your auth skill → learns YOUR security standards
  3. Scaffolds files from YOUR templates
  4. Validates output against YOUR rules
  5. Returns standards-compliant code
```

---

## Core Tools

| Tool | What It Does |
|------|-------------|
| `list_skills` | Browse all skills organized by category |
| `get_skill` | Retrieve a specific skill or category overview, or search by keyword |
| `scaffold` | Generate files from Handlebars templates with variable substitution |
| `check_standards` | Extract rules from skill docs and create a compliance checklist |

---

## Skill Categories (Included)

| Category | Skills | Description |
|----------|--------|-------------|
| **backend-patterns** | 12 | NestJS controllers, services, guards, interceptors, middleware |
| **contract-patterns** | 6 | Zod schemas, route constants, event contracts, barrel exports |
| **cross-service-patterns** | 4 | Service clients, distributed locks, response envelopes |
| **database-patterns** | 6 | Prisma ORM, db-per-service, env validation, seed data |
| **event-patterns** | 5 | RabbitMQ publishers, subscribers, event flows |
| **frontend-patterns** | 21 | React pages, data tables, forms, charts, auth, wizards |
| **infra-patterns** | 6 | Dockerfiles, docker-compose, infra generators |

---

## Using a Custom Skills Directory

By default the server loads skills from `src/skills/` inside the repo. To point it at **your own** skills library:

```bash
# Via environment variable
SKILLS_DIR=/path/to/your/skills node dist/index.js

# Or via CLI argument
node dist/index.js --skills-dir /path/to/your/skills
```

Skills are organized as Markdown files in category folders:

```
your-skills/
├── backend/
│   ├── index.md          ← category overview (optional)
│   ├── controller.md
│   └── service.md
├── frontend/
│   ├── index.md
│   └── component.md
└── testing/
    └── unit-testing.md
```

---

## Project Structure

```
mcp-toolkit/
├── src/
│   ├── index.ts                 # Server entry point
│   ├── utils/
│   │   └── skills-loader.ts     # Loads .md files from skills directory
│   ├── tools/
│   │   ├── list-skills.ts       # list_skills tool
│   │   ├── get-skill.ts         # get_skill tool
│   │   ├── scaffold.ts          # scaffold tool
│   │   └── check-standards.ts   # check_standards tool
│   └── skills/                  # Built-in knowledge base (60 skills)
│       ├── backend-patterns/
│       ├── contract-patterns/
│       ├── cross-service-patterns/
│       ├── database-patterns/
│       ├── event-patterns/
│       ├── frontend-patterns/
│       └── infra-patterns/
├── dist/                        # Compiled output (after npm run build)
├── .vscode/mcp.json             # VS Code Copilot MCP config
├── package.json
├── tsconfig.json
└── readme.md
```

## Tech Stack

- **TypeScript** • **Node.js** • **MCP SDK** (`@modelcontextprotocol/sdk`) • **Zod** for validation
- Protocol: JSON-RPC 2.0 over **stdio** transport

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `npm run build` | Compile TypeScript → `dist/` |
| `dev` | `npm run dev` | Watch mode (recompile on changes) |
| `start` | `npm start` | Run the compiled server |
| `inspect` | `npm run inspect` | Open MCP Inspector web UI |

---

## Example Usage

Once connected, try these prompts with your AI assistant:

- **"List all available skills"** → calls `list_skills`, shows all 7 categories
- **"Show me the NestJS controller pattern"** → calls `get_skill("backend-patterns/controller")`
- **"How do you handle events?"** → calls `get_skill` with keyword search across all skills
- **"Check this code against the backend standards"** → calls `check_standards`
- **"Scaffold a new microservice called inventory"** → calls `scaffold` with your templates

---

## Adding Your Own Skills

1. Create a new `.md` file in any category folder under `src/skills/`
2. Optionally add an `index.md` to the category for an overview
3. Rebuild: `npm run build`
4. The skill is immediately available via `list_skills` and `get_skill`

**Skill file format** — just write Markdown. Include sections like:

```markdown
# My Skill Name

## When to Use
...

## Rules
- Rule 1
- Rule 2

## Template
\```typescript
// code example
\```
```

The `check_standards` tool automatically extracts items from **Rules**, **Standards**, and **Checklist** sections.

---

## License

MIT
