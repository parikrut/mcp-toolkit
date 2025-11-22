# MCP Developer Toolkit

**Repo:** `github.com/parikrut/mcp-toolkit`

## What It Is

An MCP (Model Context Protocol) server that gives AI assistants **specialized development expertise**. Instead of generic coding help, it provides opinionated, battle-tested playbooks for building microservices, frontends, databases, DevOps pipelines, and more.

Works with **VS Code Copilot**, **Claude Desktop**, **Cursor**, and any MCP-compatible client.

## The Problem

AI assistants know general coding — but they don't know **your team's way of building things**. Every team has specific patterns, conventions, and standards that get lost in onboarding docs nobody reads.

## The Solution

Package your development expertise as **skills** that any AI assistant can read and follow at runtime:

```
Developer: "Create a new user authentication microservice"

AI + MCP Server:
  1. Reads your microservice skill → learns YOUR patterns
  2. Reads your auth skill → learns YOUR security standards
  3. Scaffolds files from YOUR templates
  4. Validates output against YOUR rules
  5. Returns standards-compliant code
```

## How It Works

```
┌─────────────────────────┐
│  AI Client               │
│  (Copilot / Claude)      │
│                          │
│  Discovers MCP tools:    │
│  • list_skills           │
│  • get_skill             │
│  • scaffold              │
│  • check_standards       │
└────────────┬────────────┘
             │ JSON-RPC 2.0
             ▼
┌─────────────────────────────┐
│  MCP Dev Skills Server       │
│                              │
│  Skills Library:             │
│  📁 microservices/           │
│  📁 frontend/                │
│  📁 database/                │
│  📁 devops/                  │
│  📁 testing/                 │
│                              │
│  Each skill = guides +       │
│  templates + rules           │
└─────────────────────────────┘
```

## Core Tools

| Tool | Description |
|------|-------------|
| `list_skills` | Browse available skills by category |
| `get_skill` | Retrieve a specific skill document (patterns, rules, examples) |
| `scaffold` | Generate files from skill templates |
| `check_standards` | Validate code against your team's rules |

## Skill Categories

### Microservices
- REST endpoint patterns, error handling, authentication
- Circuit breaker, saga pattern, CQRS
- Service mesh, API gateway, inter-service communication
- Scaffolds: controller, service, DTO, tests

### Frontend
- Component patterns (React/Vue/Angular), state management
- Performance optimization, SSR/SSG setup
- Accessibility, responsive design, animations
- Scaffolds: component, stories, tests, types

### Database & Data Layer
- Schema design, migrations, repository pattern
- Query optimization, indexing strategies
- Soft delete, audit trails, multi-tenancy

### DevOps & Infrastructure
- Dockerfiles (optimized multi-stage builds)
- CI/CD pipelines (GitHub Actions, GitLab CI)
- Kubernetes manifests, monitoring, alerting

### Testing
- Unit, integration, e2e test patterns
- Test factories, fixtures, contract tests
- Coverage strategies

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Protocol:** MCP (Model Context Protocol) over stdio
- **SDK:** `@modelcontextprotocol/sdk`

## Project Structure

```
mcp-toolkit/
├── src/
│   ├── index.ts                # Server entry point
│   ├── tools/
│   │   ├── list-skills.ts      # List available skills
│   │   ├── get-skill.ts        # Retrieve skill content
│   │   ├── scaffold.ts         # Generate from templates
│   │   └── check-standards.ts  # Validate against rules
│   └── skills/                 # The knowledge base
│       ├── microservices/
│       │   ├── rest-endpoint.md
│       │   ├── error-handling.md
│       │   ├── authentication.md
│       │   └── templates/
│       ├── frontend/
│       │   ├── react-component.md
│       │   ├── state-management.md
│       │   └── templates/
│       ├── database/
│       │   ├── migration.md
│       │   └── repository-pattern.md
│       ├── devops/
│       │   ├── dockerfile.md
│       │   └── ci-pipeline.md
│       └── testing/
│           ├── unit-testing.md
│           └── test-factories.md
├── .vscode/mcp.json            # VS Code Copilot config
├── package.json
├── tsconfig.json
└── README.md
```

## Client Configuration

### VS Code (GitHub Copilot)

Add `.vscode/mcp.json` to your workspace:

```json
{
  "servers": {
    "dev-skills": {
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dev-skills": {
      "command": "node",
      "args": ["/path/to/mcp-toolkit/dist/index.js"]
    }
  }
}
```

## Example Usage

**"Create a new payment microservice"**
→ AI reads your microservice + REST endpoint skills → scaffolds a complete service following your patterns

**"Add authentication to this Express app"**
→ AI reads your auth skill → implements JWT/session auth the way your team does it

**"Set up CI/CD for this repo"**
→ AI reads your CI pipeline skill → generates GitHub Actions config with your standard stages

**"Review this code against our standards"**
→ AI calls `check_standards` → flags violations of your conventions

## MVP Scope

1. Core MCP server with stdio transport
2. `list_skills` and `get_skill` tools
3. 3-5 sample skill documents (microservices, frontend, testing)
4. `scaffold` tool with basic template generation
5. VS Code + Claude Desktop config examples

## Future Roadmap

- `check_standards` tool for automated validation
- Skill authoring CLI (`mcp-toolkit add-skill`)
- Community skill packs (installable via npm)
- Custom skill authoring (YAML/Markdown format)
- SSE transport for remote/shared servers
- Prompt templates for common workflows
