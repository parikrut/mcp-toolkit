/**
 * scaffold Tool
 *
 * Generates project files based on skill templates.
 * Reads template files from the skill's templates/ directory
 * and returns the generated file contents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir, readFile } from "fs/promises";
import { join, basename, extname } from "path";
import { getSkillsDir, listSkillCategories } from "../utils/skills-loader.js";

interface TemplateFile {
  filename: string;
  content: string;
}

/**
 * Simple template variable replacement.
 * Replaces {{variableName}} with the provided values.
 */
function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    result = result.replace(regex, value);
  }
  return result;
}

/**
 * Load template files from a skill's templates/ directory
 */
async function loadTemplates(category: string): Promise<TemplateFile[]> {
  const templatesDir = join(getSkillsDir(), category, "templates");
  const templates: TemplateFile[] = [];

  try {
    const files = await readdir(templatesDir);

    for (const file of files) {
      const content = await readFile(join(templatesDir, file), "utf-8");
      templates.push({ filename: file, content });
    }
  } catch {
    // No templates directory — that's fine
  }

  return templates;
}

export function registerScaffold(server: McpServer): void {
  server.tool(
    "scaffold",
    "Generate project files from skill templates. Provide a category and name, and this tool returns rendered template files you can write to your project.",
    {
      category: z
        .string()
        .describe(
          "Skill category to scaffold from (e.g. 'microservices', 'frontend')"
        ),
      name: z
        .string()
        .describe(
          "Name for the generated component/service (e.g. 'user-auth', 'PaymentForm')"
        ),
      variables: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Additional template variables as key-value pairs (e.g. {\"port\": \"3001\", \"database\": \"postgres\"})"
        ),
    },
    async ({ category, name, variables = {} }) => {
      // Load templates for this category
      const templates = await loadTemplates(category);

      if (templates.length === 0) {
        // List available categories that have templates
        const categories = await listSkillCategories();
        const available = categories.map((c) => c.name).join(", ");

        return {
          content: [
            {
              type: "text" as const,
              text: `No templates found for category "${category}".\n\nAvailable categories: ${available}\n\nNote: Templates should be placed in src/skills/${category}/templates/`,
            },
          ],
        };
      }

      // Build template variables
      const allVars: Record<string, string> = {
        name,
        Name: name.charAt(0).toUpperCase() + name.slice(1),
        NAME: name.toUpperCase(),
        "name-kebab": name.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, ""),
        name_snake: name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, ""),
        nameCAMEL: name.charAt(0).toLowerCase() + name.slice(1),
        ...variables,
      };

      // Render all templates
      const lines: string[] = [
        `# Scaffolded Files for "${name}" (${category})`,
        "",
        `Generated ${templates.length} file(s) with variables:`,
        "```json",
        JSON.stringify(allVars, null, 2),
        "```",
        "",
      ];

      for (const template of templates) {
        // Replace .hbs or .template extension, and substitute name in filename
        let outputFilename = template.filename
          .replace(/\.hbs$/, "")
          .replace(/\.template$/, "")
          .replace(/\{\{name\}\}/g, allVars["name-kebab"] || name);

        const rendered = renderTemplate(template.content, allVars);

        lines.push(`## 📄 ${outputFilename}`);
        lines.push("```");
        lines.push(rendered);
        lines.push("```");
        lines.push("");
      }

      lines.push(
        "---",
        "Copy these files into your project and customize as needed."
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
