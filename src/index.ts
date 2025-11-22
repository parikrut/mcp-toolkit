#!/usr/bin/env node

/**
 * MCP Developer Toolkit - Entry Point
 *
 * An MCP server that gives AI assistants specialized development expertise.
 * Skills are loaded from markdown files and exposed via tools.
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
    "MCP server that provides specialized development skills and patterns",
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
