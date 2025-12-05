/**
 * get_skill Tool
 *
 * Retrieves skill documents — either a specific skill, a category overview,
 * or searches across all skills by keyword.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSkillById,
  searchSkills,
  listSkillCategories,
} from "../utils/skills-loader.js";

export function registerGetSkill(server: McpServer): void {
  server.tool(
    "get_skill",
    "Retrieve a development skill document. Pass an ID like 'backend-patterns/controller' for a specific skill, or 'backend-patterns' for the category overview (index.md). Use 'search' to find skills by keyword.",
    {
      id: z
        .string()
        .optional()
        .describe(
          "Skill or category ID. Examples: 'backend-patterns/controller' (specific skill), 'backend-patterns' (category overview)"
        ),
      search: z
        .string()
        .optional()
        .describe("Search skills by keyword across all categories (e.g. 'authentication', 'prisma', 'docker')"),
    },
    async ({ id, search }) => {
      // If an ID is provided, fetch that specific skill or category
      if (id) {
        const skill = await getSkillById(id);

        if (!skill) {
          // Help the user find the right skill
          const categories = await listSkillCategories();
          const suggestions: string[] = [];

          // Check if the ID partially matches any category or skill
          const lowerID = id.toLowerCase();
          for (const cat of categories) {
            if (cat.name.toLowerCase().includes(lowerID)) {
              suggestions.push(`📁 ${cat.name} (category)`);
            }
            for (const s of cat.skills) {
              if (s.id.toLowerCase().includes(lowerID) || s.name.toLowerCase().includes(lowerID)) {
                suggestions.push(`📄 ${s.id}`);
              }
            }
          }

          let text = `Skill "${id}" not found.`;
          if (suggestions.length > 0) {
            text += `\n\nDid you mean:\n${suggestions.slice(0, 10).map((s) => `- ${s}`).join("\n")}`;
          } else {
            const allCategories = categories.map((c) => c.name).join(", ");
            text += `\n\nAvailable categories: ${allCategories}`;
          }

          return {
            content: [{ type: "text" as const, text }],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: skill.content,
            },
          ],
        };
      }

      // If search query is provided, search across all skills
      if (search) {
        const results = await searchSkills(search);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No skills found matching "${search}". Use list_skills to see all available skills.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `# Search Results for "${search}"`,
          "",
          `Found ${results.length} skill(s):`,
          "",
        ];

        for (const skill of results) {
          // Show a preview (first 200 chars of content)
          const preview = skill.content
            .split("\n")
            .filter((l) => l.trim() && !l.startsWith("#"))
            .slice(0, 3)
            .join(" ")
            .substring(0, 200);
          lines.push(`### ${skill.name} (\`${skill.id}\`)`);
          lines.push(`${preview}...`);
          lines.push("");
        }

        lines.push(
          "---",
          "Use `get_skill` with a specific ID to read the full skill document."
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      }

      // Neither ID nor search provided
      return {
        content: [
          {
            type: "text" as const,
            text: 'Please provide either:\n- `id`: skill ID like "backend-patterns/controller" or category name like "backend-patterns"\n- `search`: keyword to search across all skills',
          },
        ],
      };
    }
  );
}
