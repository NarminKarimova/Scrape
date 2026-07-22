import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".open-next");

if (!existsSync(target)) {
  process.exit(0);
}

for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    process.exit(0);
  } catch (error) {
    if (attempt === 5) {
      console.error(
        "Could not remove .open-next. Stop `npm run dev` / preview processes, then retry deploy.",
      );
      console.error(error);
      process.exit(1);
    }
    await setTimeout(attempt * 500);
  }
}
