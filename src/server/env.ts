import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let fileEnv: Record<string, string> | null = null;

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadFileEnv(): Record<string, string> {
  if (fileEnv) return fileEnv;
  const envPath = resolve(process.cwd(), ".env");
  fileEnv = existsSync(envPath) ? parseDotEnv(readFileSync(envPath, "utf8")) : {};
  return fileEnv;
}

/** Server-only. Avoids Vite stripping non-VITE_ process.env keys. */
export function getServerEnv(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  const fromFile = loadFileEnv()[name]?.trim();
  return fromFile || undefined;
}
