/**
 * cobra-client configuration.
 *
 * Resolution order (highest wins): CLI flags > environment > config file > defaults.
 * The OpenRouter API key is NEVER written to disk or echoed — it lives only in
 * memory and is sent solely to the OpenRouter endpoint.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export interface ServerSpec {
  /** Display name */
  name: string;
  /** Executable that launches the MCP server */
  command: string;
  /** Args for the executable */
  args: string[];
  /** Extra env passed to the server (scope, loot dir, brain path, …) */
  env: Record<string, string>;
  /** Working directory for the server process */
  cwd?: string;
}

export interface ClientConfig {
  /** OpenRouter secret key — in-memory only. */
  apiKey: string;
  /** OpenRouter model id, e.g. "kwaipilot/kat-coder-pro-v2.5". */
  model: string;
  /** OpenRouter base URL (override for proxies/gateways). */
  baseUrl: string;
  /** MCP server to spawn + connect to. */
  server: ServerSpec;
  /** Max agent loop iterations before forcing a stop. */
  maxTurns: number;
  /** Sampling temperature. */
  temperature: number;
  /** Max tokens per completion. */
  maxTokens: number;
  /** Extra HTTP referer header for OpenRouter rankings (optional). */
  siteUrl?: string;
  /** Extra title header for OpenRouter rankings (optional). */
  siteName?: string;
}

export const DEFAULT_MODEL = "kwaipilot/kat-coder-pro-v2.5";
export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** Repo root = cobra-client/build/.. → ../.. (i.e. the CobraStrike checkout).
 * (fileURLToPath: URL.pathname would percent-encode spaces and break on repos
 * checked out under e.g. 'cobra OS/'.) */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

function defaultServer(): ServerSpec {
  const serverEntry = path.join(REPO_ROOT, "cobra-mcp", "build", "index.js");
  return {
    name: "cobra",
    command: process.execPath, // node
    args: [serverEntry],
    env: {
      // The MCP SDK spawns the server with a WHITELISTED inherited env plus
      // exactly this map — nothing else from the client's environment crosses
      // over, so every COBRA_* knob must be forwarded here explicitly.
      COBRA_REPO_ROOT: process.env.COBRA_REPO_ROOT ?? REPO_ROOT,
      COBRA_ALLOW_INTERNET: process.env.COBRA_ALLOW_INTERNET ?? "0",
      COBRA_ENABLE_TUNNELS: process.env.COBRA_ENABLE_TUNNELS ?? "0",
      // Phase 4: shell_run's OWN gate. Deliberately NOT the same knob as
      // tunnels — arbitrary local exec is a separate blast radius.
      COBRA_ENABLE_SHELL: process.env.COBRA_ENABLE_SHELL ?? "0",
      // Phase 5: Tor proxy. Own gate, independent axis from ALLOW_INTERNET.
      // Only forwarded when the operator set COBRA_PROXY — unset = system tor.
      COBRA_ENABLE_PROXY: process.env.COBRA_ENABLE_PROXY ?? "0",
      ...(process.env.COBRA_PROXY ? { COBRA_PROXY: process.env.COBRA_PROXY } : {}),
      COBRA_ALLOWED_SCOPE: process.env.COBRA_ALLOWED_SCOPE ?? "",
      COBRA_LOOT_DIR:
        process.env.COBRA_LOOT_DIR ?? path.join(REPO_ROOT, "loot"),
      COBRA_BRAIN_PATH:
        process.env.COBRA_BRAIN_PATH ?? path.join(REPO_ROOT, "brain", "BRAIN.md"),
      COBRA_TRADECRAFT_DIR:
        process.env.COBRA_TRADECRAFT_DIR ?? path.join(REPO_ROOT, "tradecraft"),
      // Self-hosted gsocket relay for the c2_gs_* tools (native gsocket env).
      // Forwarded only when the operator set them — unset means the public
      // GSRN, which the server egress-gates on COBRA_ALLOW_INTERNET.
      ...(process.env.GS_HOST ? { GS_HOST: process.env.GS_HOST } : {}),
      ...(process.env.GS_PORT ? { GS_PORT: process.env.GS_PORT } : {}),
    },
  };
}

function configDir(): string {
  return path.join(os.homedir(), ".config", "cobra");
}

function configFile(): string {
  return path.join(configDir(), "config.json");
}

interface FileConfig {
  model?: string;
  baseUrl?: string;
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
  siteUrl?: string;
  siteName?: string;
  server?: Partial<ServerSpec>;
}

function readFileConfig(): FileConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf8");
    return JSON.parse(raw) as FileConfig;
  } catch {
    return {};
  }
}

export function writeFileConfig(patch: FileConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  const current = readFileConfig();
  const next = { ...current, ...patch };
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function configPath(): string {
  return configFile();
}

export interface CliOverrides {
  model?: string;
  baseUrl?: string;
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
  serverCommand?: string;
  serverArgs?: string[];
  scope?: string;
  lootDir?: string;
}

/**
 * Build the effective config. `apiKey` must already be resolved (env/flag/prompt)
 * and is passed in explicitly so it is never persisted here.
 */
export function loadConfig(apiKey: string, cli: CliOverrides = {}): ClientConfig {
  const file = readFileConfig();
  const server = defaultServer();

  if (file.server) {
    if (file.server.command) server.command = file.server.command;
    if (file.server.args) server.args = file.server.args;
    if (file.server.env) server.env = { ...server.env, ...file.server.env };
    if (file.server.cwd) server.cwd = file.server.cwd;
  }
  if (cli.serverCommand) server.command = cli.serverCommand;
  if (cli.serverArgs) server.args = cli.serverArgs;
  if (cli.scope !== undefined) server.env.COBRA_ALLOWED_SCOPE = cli.scope;
  if (cli.lootDir) server.env.COBRA_LOOT_DIR = cli.lootDir;

  return {
    apiKey,
    model: cli.model ?? process.env.COBRA_MODEL ?? file.model ?? DEFAULT_MODEL,
    baseUrl:
      cli.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? file.baseUrl ?? DEFAULT_BASE_URL,
    server,
    maxTurns: cli.maxTurns ?? num(process.env.COBRA_MAX_TURNS) ?? file.maxTurns ?? 40,
    temperature:
      cli.temperature ?? num(process.env.COBRA_TEMPERATURE) ?? file.temperature ?? 0.2,
    // 16 Ki default: full-document brain_write rewrites need headroom. A
    // 4096-token ceiling truncates a medium brain's tool_call argument
    // mid-JSON, which the agent now reports as TOOL ARG PARSE ERROR.
    maxTokens: cli.maxTokens ?? num(process.env.COBRA_MAX_TOKENS) ?? file.maxTokens ?? 16384,
    siteUrl: process.env.COBRA_SITE_URL ?? file.siteUrl,
    siteName: process.env.COBRA_SITE_NAME ?? file.siteName ?? "CobraStrike",
  };
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
