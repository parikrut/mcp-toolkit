/**
 * Skills Loader Utility
 *
 * Loads skill documents from a configurable skills directory.
 * Skills are organized by category (folders) and are markdown files.
 * Each category can have an index.md that serves as the category overview.
 *
 * The skills directory is resolved in this order:
 * 1. SKILLS_DIR environment variable (absolute path)
 * 2. --skills-dir CLI argument
 * 3. Default: src/skills/ relative to this package
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, dirname, basename, extname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the skills directory from env, CLI args, or default.
 */
function resolveSkillsDir(): string {
  // 1. Environment variable
  if (process.env.SKILLS_DIR) {
    return resolve(process.env.SKILLS_DIR);
  }

  // 2. CLI argument: --skills-dir /path/to/skills
  const argIndex = process.argv.indexOf("--skills-dir");
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return resolve(process.argv[argIndex + 1]);
  }

  // 3. Default: src/skills/ relative to the package root
  return join(__dirname, "..", "..", "src", "skills");
}

const SKILLS_DIR = resolveSkillsDir();

export interface Skill {
  /** e.g. "backend-patterns/controller" */
  id: string;
  /** e.g. "Controller" (from filename) */
  name: string;
  /** e.g. "backend-patterns" */
  category: string;
  /** Full markdown content */
  content: string;
  /** File path on disk */
  filePath: string;
}

export interface SkillCategory {
  name: string;
  /** Short description from index.md first line, if available */
  description: string;
  /** Whether this category has an index.md overview */
  hasIndex: boolean;
  skills: { id: string; name: string }[];
}

/**
 * Convert a filename like "rest-endpoint.md" to a display name like "Rest Endpoint"
 */
function fileNameToDisplayName(filename: string): string {
  return basename(filename, extname(filename))
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract the first meaningful line from an index.md as a description.
 * Skips the H1 heading and looks for the first paragraph or blockquote.
 */
function extractDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, headings, and code fences
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```")) continue;
    // Capture blockquote lines (common in your index files)
    if (trimmed.startsWith(">")) {
      return trimmed.replace(/^>\s*/, "").trim();
    }
    // Capture first paragraph
    if (trimmed.length > 10) {
      return trimmed.length > 120 ? trimmed.slice(0, 120) + "..." : trimmed;
    }
  }
  return "";
}

/**
 * List all skill categories and their skills.
 * Reads index.md for category descriptions.
 */
export async function listSkillCategories(): Promise<SkillCategory[]> {
  const categories: SkillCategory[] = [];

  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const categoryPath = join(SKILLS_DIR, entry.name);
      const files = await readdir(categoryPath);

      // Check for index.md
      let description = "";
      let hasIndex = false;
      if (files.includes("index.md")) {
        hasIndex = true;
        try {
          const indexContent = await readFile(
            join(categoryPath, "index.md"),
            "utf-8"
          );
          description = extractDescription(indexContent);
        } catch {
          // ignore
        }
      }

      const skills = files
        .filter((f) => f.endsWith(".md") && f !== "index.md")
        .map((f) => ({
          id: `${entry.name}/${basename(f, ".md")}`,
          name: fileNameToDisplayName(f),
        }));

      if (skills.length > 0 || hasIndex) {
        categories.push({
          name: entry.name,
          description,
          hasIndex,
          skills,
        });
      }
    }
  } catch (error) {
    console.error("Error listing skills from", SKILLS_DIR, ":", error);
  }

  return categories;
}

/**
 * Get a single skill by its ID (e.g. "backend-patterns/controller")
 * Also supports category IDs (e.g. "backend-patterns") to return the index.md
 */
export async function getSkillById(id: string): Promise<Skill | null> {
  // Try as a direct skill file first
  const filePath = join(SKILLS_DIR, `${id}.md`);
  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      const content = await readFile(filePath, "utf-8");
      const parts = id.split("/");
      const category = parts[0];
      const name = fileNameToDisplayName(parts[parts.length - 1]);
      return { id, name, category, content, filePath };
    }
  } catch {
    // not found as file, try as category
  }

  // Try as a category (return its index.md)
  const indexPath = join(SKILLS_DIR, id, "index.md");
  try {
    const stats = await stat(indexPath);
    if (stats.isFile()) {
      const content = await readFile(indexPath, "utf-8");
      return {
        id: `${id}/index`,
        name: fileNameToDisplayName(id) + " (Overview)",
        category: id,
        content,
        filePath: indexPath,
      };
    }
  } catch {
    // not found
  }

  return null;
}

/**
 * Search skills by keyword in their content
 */
export async function searchSkills(query: string): Promise<Skill[]> {
  const results: Skill[] = [];
  const categories = await listSkillCategories();
  const lowerQuery = query.toLowerCase();

  for (const category of categories) {
    for (const skillRef of category.skills) {
      const skill = await getSkillById(skillRef.id);
      if (
        skill &&
        (skill.content.toLowerCase().includes(lowerQuery) ||
          skill.name.toLowerCase().includes(lowerQuery) ||
          skill.category.toLowerCase().includes(lowerQuery))
      ) {
        results.push(skill);
      }
    }
  }

  return results;
}

/**
 * Get the resolved skills directory path (for scaffold templates)
 */
export function getSkillsDir(): string {
  return SKILLS_DIR;
}
