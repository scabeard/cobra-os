/**
 * CobraStrike MCP server configuration.
 * All values come from environment variables set in the MCP client config.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// repo root = cobra-mcp/build/.. → ../..
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export interface CobraConfig {
  /** 1 = tools may reach beyond scope (e.g. fetch linpeas). Default deny. */
  allowInternet: boolean;
  /** Raw scope string, comma-separated CIDRs and domains. Empty = deny all. */
  allowedScopeRaw: string;
  /** Directory where all tool output (loot) lands. */
  lootDir: string;
  /** Path to the brain file. */
  brainPath: string;
  /** Directory containing tradecraft guides. */
  tradecraftDir: string;
  /** Repo root (for locating scripts, BUILD_PLAN, etc). */
  repoRoot: string;
}

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): CobraConfig {
  return {
    allowInternet: envBool("COBRA_ALLOW_INTERNET", false),
    allowedScopeRaw: process.env.COBRA_ALLOWED_SCOPE ?? "",
    lootDir: process.env.COBRA_LOOT_DIR ?? path.join(REPO_ROOT, "loot"),
    brainPath: process.env.COBRA_BRAIN_PATH ?? path.join(REPO_ROOT, "brain", "BRAIN.md"),
    tradecraftDir: process.env.COBRA_TRADECRAFT_DIR ?? path.join(REPO_ROOT, "tradecraft"),
    repoRoot: REPO_ROOT,
  };
}

export const CONFIG = loadConfig();
