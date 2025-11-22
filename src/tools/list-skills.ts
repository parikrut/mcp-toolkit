/**
 * list_skills Tool
 *
 * Lists all available skills organized by category.
 * Optionally filters by category name.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listSkillCategories } from "../utils/skills-loader.js";

export function registerListSkills(server: McpServer): void {
  server.tool(
    "list_skills",
    "List all available development skills organized by category. Optionally filter by a specific category.",
    {
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category name (e.g. 'microservices', 'frontend', 'database', 'devops', 'testing')"
        ),
    },
    async ({ category }) => {
      const categories = await listSkillCategories();

      if (categories.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No skills found. Add .md files to the src/skills/<category>/ directories.",
            },
          ],
        };
      }

      // Filter by category if specified
      const filtered = category
        ? categories.filter(
            (c) => c.name.toLowerCase() === category.toLowerCase()
          )
        : categories;

      if (filtered.length === 0) {
        const available = categories.map((c) => c.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Category "${category}" not found. Available categories: ${available}`,
            },
          ],
        };
      }

      // Format the output
      const lines: string[] = ["# Available Development Skills", ""];

      for (const cat of filtered) {
        lines.push(`## ${cat.name}`);
        for (const skill of cat.skills) {
          lines.push(`- **${skill.name}** → \`get_skill("${skill.id}")\``);
        }
        lines.push("");
      }

      lines.push(
        "---",
        'Use `get_skill` with the skill ID to read the full skill document.'
      );

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
      };
    }
  );
}
