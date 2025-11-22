/**
 * check_standards Tool
 *
 * Validates code or project structure against rules defined in skill documents.
 * Extracts "Rules" or "Standards" sections from skills and checks compliance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSkillById, listSkillCategories } from "../utils/skills-loader.js";

/**
 * Extract rules/standards from a skill document.
 * Looks for sections with headers containing "Rule", "Standard", "Checklist", or "Must".
 */
function extractRules(content: string): string[] {
  const rules: string[] = [];
  const lines = content.split("\n");

  let inRulesSection = false;

  for (const line of lines) {
    // Check if we're entering a rules section
    if (
      line.match(
        /^#{1,3}\s.*(rule|standard|checklist|must|requirement|convention)/i
      )
    ) {
      inRulesSection = true;
      continue;
    }

    // Check if we're leaving the rules section (next header)
    if (inRulesSection && line.match(/^#{1,3}\s/) && !line.match(/rule|standard|checklist|must|requirement|convention/i)) {
      inRulesSection = false;
      continue;
    }

    // Capture bullet points and numbered items in rules sections
    if (inRulesSection) {
      const match = line.match(/^[\s]*[-*]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/);
      if (match) {
        rules.push(match[1].trim());
      }
    }
  }

  // Also capture any lines that start with ✅, ❌, ⚠️, MUST, SHOULD, etc.
  for (const line of lines) {
    if (
      line.match(/^[\s]*[-*]\s*(✅|❌|⚠️|MUST|SHOULD|SHALL|REQUIRED)/i) &&
      !rules.includes(line.trim())
    ) {
      rules.push(line.replace(/^[\s]*[-*]\s*/, "").trim());
    }
  }

  return rules;
}

export function registerCheckStandards(server: McpServer): void {
  server.tool(
    "check_standards",
    "Check code or project structure against the rules and standards defined in a skill. Provide the skill ID and the code to validate.",
    {
      skill_id: z
        .string()
        .describe(
          "Skill ID whose rules to check against (e.g. 'microservices/rest-endpoint')"
        ),
      code: z
        .string()
        .optional()
        .describe("Code to validate against the skill's standards"),
      description: z
        .string()
        .optional()
        .describe(
          "Description of what was built (for structural/pattern validation)"
        ),
    },
    async ({ skill_id, code, description }) => {
      const skill = await getSkillById(skill_id);

      if (!skill) {
        const categories = await listSkillCategories();
        const allSkills = categories.flatMap((c) =>
          c.skills.map((s) => s.id)
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Skill "${skill_id}" not found.\n\nAvailable skills:\n${allSkills.map((s) => `- ${s}`).join("\n")}`,
            },
          ],
        };
      }

      const rules = extractRules(skill.content);

      const lines: string[] = [
        `# Standards Check: ${skill.name}`,
        `**Skill:** ${skill.id}`,
        "",
      ];

      if (rules.length === 0) {
        lines.push(
          "⚠️ No explicit rules/standards section found in this skill document.",
          "",
          "The skill document may still contain useful patterns and examples.",
          "Consider adding a '## Rules' or '## Standards' section to the skill."
        );
      } else {
        lines.push(`Found **${rules.length}** rules/standards to check against:`, "");

        lines.push("## Checklist");
        lines.push("");
        for (const rule of rules) {
          lines.push(`- [ ] ${rule}`);
        }
        lines.push("");
      }

      if (code) {
        lines.push("## Code Provided for Review");
        lines.push("```");
        lines.push(code);
        lines.push("```");
        lines.push("");
      }

      if (description) {
        lines.push("## Implementation Description");
        lines.push(description);
        lines.push("");
      }

      lines.push("---");
      lines.push(
        "Review the checklist above against the provided code/description.",
        "The AI assistant should verify each rule and report compliance."
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
