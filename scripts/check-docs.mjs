// Validate the Markdown documentation contract without external dependencies.
// Every Markdown document must explain its content, purpose, and update trigger
// near the top. Relative file links must resolve inside the repository.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([
  "node_modules", ".git", "dist", ".turbo", ".venv", "__pycache__", ".agents", ".codex",
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith(".md") ? [full] : [];
  });
}

const failures = [];
const files = walk(root).sort();
const linkPattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const opening = text.split(/\r?\n/).slice(0, 24).join("\n");

  for (const field of ["内容", "作用", "何时更新"]) {
    if (!opening.includes(field)) failures.push(`${rel}: opening is missing “${field}”`);
  }

  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = decodeURIComponent(target.split("#", 1)[0]);
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      failures.push(`${rel}: relative link escapes repository: ${match[1]}`);
    } else if (!fs.existsSync(resolved)) {
      failures.push(`${rel}: missing relative link target: ${match[1]}`);
    }
  }
}

if (failures.length) {
  console.error(`Documentation validation failed (${failures.length} issue(s)):\n${failures.map((x) => `- ${x}`).join("\n")}`);
  process.exit(1);
}

console.log(`Documentation validation passed: ${files.length} Markdown files.`);
