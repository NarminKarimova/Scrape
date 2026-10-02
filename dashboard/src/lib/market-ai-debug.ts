import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DEBUG_DIR = join(process.cwd(), "debug");
const DEBUG_FILE = join(DEBUG_DIR, "market-ai.log");

export function marketAiDebugLog(scope: string, label: string, data: unknown) {
  const entry = {
    at: new Date().toISOString(),
    scope,
    label,
    data,
  };
  const line = JSON.stringify(entry, null, 2);
  console.log(`[${scope}:${label}]`, JSON.stringify(data, null, 2));
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    appendFileSync(DEBUG_FILE, `${line}\n`, "utf8");
  } catch (error) {
    console.warn("[market-ai-debug:file-write-failed]", error);
  }
}

