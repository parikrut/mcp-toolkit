/**
 * list_skills Tool
 *
 * Lists all available skills organized by category.
 * Shows category descriptions from index.md and supports filtering.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listSkillCategories } from "../utils/skills-loader.js";

export function registerListSkills(server: McpServer): void {
  server.tool(
    "list_skills",
    "List all available development skills organized by category. Each category may have an overview (index) and individual skill documents. Use get_skill to read a skill or category overview.",
    {
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category name (e.g. 'backend-patterns', 'frontend-patterns')"
        ),
    },
    async ({ category }) => {
      const categories = await listSkillCategories();

      if (categories.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No skills found. Set SKILLS_DIR env var or --skills-dir arg to point to your skills directory, or add .md files to the default src/skills/<category>/ directories.",
            },
          ],
        };
      }

      // Filter by category if specified (support partial matching)
      const filtered = category
        ? categories.filter(
            (c) =>
              c.name.toLowerCase() === category.toLowerCase() ||
              c.name.toLowerCase().includes(category.toLowerCase())
          )
        : categories;

      if (filtered.length === 0) {
        const available = categories.map((c) => c.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Category "${category}" not found.\n\nAvailable categories: ${available}`,
            },
          ],
        };
      }

      // Format the output
      const totalSkills = filtered.reduce((sum, c) => sum + c.skills.length, 0);
      const lines: string[] = [
        "# Available Development Skills",
        `**${filtered.length} categories, ${totalSkills} skills**`,
        "",
      ];

      for (const cat of filtered) {
        lines.push(`## ${cat.name} (${cat.skills.length} skills)`);
        if (cat.description) {
          lines.push(`> ${cat.description}`);
        }
        if (cat.hasIndex) {
          lines.push(
            `📋 Overview: \`get_skill("${cat.name}")\``
          );
        }
        lines.push("");
        for (const skill of cat.skills) {
          lines.push(`- **${skill.name}** → \`get_skill("${skill.id}")\``);
        }
        lines.push("");
      }

      lines.push(
        "---",
        "**Usage:**",
        '- `get_skill("category-name")` — read the category overview (index.md)',
        '- `get_skill("category-name/skill-name")` — read a specific skill',
        '- `get_skill({ search: "keyword" })` — search across all skills',
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
