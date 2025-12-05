#!/usr/bin/env node

/**
 * MCP Developer Toolkit - Entry Point
 *
 * An MCP server that gives AI assistants specialized development expertise.
 * Skills are loaded from a configurable directory of markdown documents.
 *
 * Configuration:
 *   SKILLS_DIR env var — absolute path to skills directory
 *   --skills-dir arg  — absolute path to skills directory
 *   Default: src/skills/ in this package
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListSkills } from "./tools/list-skills.js";
import { registerGetSkill } from "./tools/get-skill.js";
import { registerScaffold } from "./tools/scaffold.js";
import { registerCheckStandards } from "./tools/check-standards.js";

// Create the MCP server
const server = new McpServer({
  name: "dev-skills",
  version: "1.0.0",
  description:
    "MCP server that provides specialized development skills, patterns, and scaffolding templates",
});

// Register all tools
registerListSkills(server);
registerGetSkill(server);
registerScaffold(server);
registerCheckStandards(server);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Dev Skills server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
