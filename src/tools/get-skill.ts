/**
 * get_skill Tool
 *
 * Retrieves the full content of a specific skill document.
 * Skills are markdown files containing patterns, rules, and examples.
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
    "Retrieve a specific development skill document by ID, or search skills by keyword. Returns patterns, rules, examples, and templates.",
    {
      id: z
        .string()
        .optional()
        .describe(
          "Skill ID in format 'category/skill-name' (e.g. 'microservices/rest-endpoint')"
        ),
      search: z
        .string()
        .optional()
        .describe("Search skills by keyword (e.g. 'authentication', 'react')"),
    },
    async ({ id, search }) => {
      // If an ID is provided, fetch that specific skill
      if (id) {
        const skill = await getSkillById(id);

        if (!skill) {
          // Help the user find the right skill
          const categories = await listSkillCategories();
          const allSkills = categories.flatMap((c) =>
            c.skills.map((s) => s.id)
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `Skill "${id}" not found.\n\nAvailable skills:\n${allSkills.map((s) => `- ${s}`).join("\n")}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `# Skill: ${skill.name}\n**Category:** ${skill.category}\n**ID:** ${skill.id}\n\n---\n\n${skill.content}`,
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
          const preview = skill.content.substring(0, 200).replace(/\n/g, " ");
          lines.push(`## ${skill.name} (\`${skill.id}\`)`);
          lines.push(`${preview}...`);
          lines.push("");
        }

        lines.push(
          "---",
          "Use `get_skill` with a specific ID to read the full skill document."
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

      // Neither ID nor search provided
      return {
        content: [
          {
            type: "text" as const,
            text: 'Please provide either an "id" (e.g. "microservices/rest-endpoint") or a "search" query.',
          },
        ],
      };
    }
  );
}
