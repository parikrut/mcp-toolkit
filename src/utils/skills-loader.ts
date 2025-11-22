/**
 * Skills Loader Utility
 *
 * Loads skill documents from the skills/ directory.
 * Skills are organized by category (folders) and are markdown files.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, dirname, relative, basename, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Skills live in src/skills/ relative to the project root
// When compiled, this file is at dist/utils/skills-loader.js, so we go up 2 levels
const SKILLS_DIR = join(__dirname, "..", "..", "src", "skills");

export interface Skill {
  /** e.g. "microservices/rest-endpoint" */
  id: string;
  /** e.g. "REST Endpoint" (from filename) */
  name: string;
  /** e.g. "microservices" */
  category: string;
  /** Full markdown content */
  content: string;
  /** File path on disk */
  filePath: string;
}

export interface SkillCategory {
  name: string;
  skills: { id: string; name: string }[];
}

/**
 * Convert a filename like "rest-endpoint.md" to a display name like "REST Endpoint"
 */
function fileNameToDisplayName(filename: string): string {
  return basename(filename, extname(filename))
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * List all skill categories and their skills
 */
export async function listSkillCategories(): Promise<SkillCategory[]> {
  const categories: SkillCategory[] = [];

  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const categoryPath = join(SKILLS_DIR, entry.name);
      const files = await readdir(categoryPath);

      const skills = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({
          id: `${entry.name}/${basename(f, ".md")}`,
          name: fileNameToDisplayName(f),
        }));

      if (skills.length > 0) {
        categories.push({
          name: entry.name,
          skills,
        });
      }
    }
  } catch (error) {
    console.error("Error listing skills:", error);
  }

  return categories;
}

/**
 * Get a single skill by its ID (e.g. "microservices/rest-endpoint")
 */
export async function getSkillById(id: string): Promise<Skill | null> {
  const filePath = join(SKILLS_DIR, `${id}.md`);

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;

    const content = await readFile(filePath, "utf-8");
    const parts = id.split("/");
    const category = parts[0];
    const name = fileNameToDisplayName(parts[parts.length - 1]);

    return {
      id,
      name,
      category,
      content,
      filePath,
    };
  } catch {
    return null;
  }
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
 * Get the skills directory path (for scaffold templates)
 */
export function getSkillsDir(): string {
  return SKILLS_DIR;
}
