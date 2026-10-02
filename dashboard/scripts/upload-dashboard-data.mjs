import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = process.env.R2_BUCKET_NAME ?? "scrape";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "processed");

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

if (!existsSync(ROOT)) {
  console.error(`Missing ${ROOT}. Run npm run build-data first.`);
  process.exit(1);
}

const files = walkFiles(ROOT);
if (files.length === 0) {
  console.error(`No processed JSON files found under ${ROOT}`);
  process.exit(1);
}

console.log(`Uploading ${files.length} processed JSON files to remote R2 bucket "${BUCKET}"...`);

for (const file of files) {
  const key = path.relative(ROOT, file).replace(/\\/g, "/");
  console.log(`→ ${key}`);
  execSync(`npx wrangler r2 object put ${BUCKET}/${key} --file="${file}" --remote`, {
    stdio: "inherit",
  });
}

console.log("Done.");
