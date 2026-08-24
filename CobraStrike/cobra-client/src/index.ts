#!/usr/bin/env node
/**
 * cobra — CobraStrike headless MCP client.
 *
 * Self-contained AI agent that spawns the cobra-mcp server, connects over stdio,
 * and drives it with an LLM from OpenRouter. Authorized use only.
 *
 * Subcommands:
 *   run [task]        run a single task headlessly (or interactive chat if no task)
 *   mission <file>    load a brain/missions/*.mission.md and execute it
 *   chat              interactive REPL with the agent
 *   models            list OpenRouter models (picker)
 *   setup             configure model + securely store the OpenRouter key
 *   tools             list tools exposed by the MCP server
 *   doctor            sanity-check server, key, and connectivity
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { loadConfig, writeFileConfig, configPath, DEFAULT_MODEL, type CliOverrides } from "./config.js";
import { resolveApiKey, saveKey, clearKey, promptKeyHidden } from "./keystore.js";
import { CobraMcp } from "./mcp.js";
import { OpenRouter } from "./openrouter.js";
import { Agent } from "./agent.js";
import { gatherContext, buildSystemPrompt } from "./prompt.js";
import { ui, Spinner } from "./ui.js";

interface ParsedArgs {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let cmd = "run";
  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("-")) {
    cmd = args.shift()!;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

function flagStr(f: Record<string, string | boolean>, k: string): string | undefined {
  const v = f[k];
  return typeof v === "string" ? v : undefined;
}

function flagNum(f: Record<string, string | boolean>, k: string): number | undefined {
  const v = flagStr(f, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function cliOverrides(f: Record<string, string | boolean>): CliOverrides {
  return {
    model: flagStr(f, "model"),
    baseUrl: flagStr(f, "base-url"),
    maxTurns: flagNum(f, "max-turns"),
    temperature: flagNum(f, "temperature"),
    maxTokens: flagNum(f, "max-tokens"),
    serverCommand: flagStr(f, "server-command"),
    serverArgs: flagStr(f, "server-args")?.split(" "),
    scope: flagStr(f, "scope"),
    lootDir: flagStr(f, "loot-dir"),
  };
}

const HELP = `cobra — CobraStrike headless MCP client

USAGE
  cobra <command> [options]

COMMANDS
  run [task]          Run a task headlessly; interactive chat if no task given
  mission <file>      Execute a brain/missions/*.mission.md file
  chat                Interactive REPL with the agent
  models              List available OpenRouter models
  setup               Configure model + securely store your OpenRouter key
  tools               List tools exposed by the MCP server
  doctor              Sanity-check server, API key, and connectivity

OPTIONS
  --model <id>        OpenRouter model id (default: ${DEFAULT_MODEL})
  --api-key <key>     OpenRouter key (else env OPENROUTER_API_KEY / saved / prompt)
  --base-url <url>    Override OpenRouter base URL
  --scope <cidrs>     Set COBRA_ALLOWED_SCOPE for the server
  --loot-dir <dir>    Set COBRA_LOOT_DIR for the server
  --max-turns <n>     Max agent loop iterations (default 40)
  --temperature <n>   Sampling temperature (default 0.2)
  --max-tokens <n>    Max tokens per completion (default 4096)
  --save-key          (setup) persist the key to ~/.config/cobra/credentials (0600)
  --server-command <c>  Override MCP server executable
  --server-args <a>     Override MCP server args (space-separated)
  -h, --help          Show this help

EXAMPLES
  cobra setup --save-key
  cobra models --filter claude
  cobra run "Recon triage the active target and update the brain"
  cobra mission brain/missions/htb-blue.mission.md --model kwaipilot/kat-coder-pro-v2.5
  cobra chat
`;

async function connectMcp(overrides: CliOverrides): Promise<{ mcp: CobraMcp; cfg: ReturnType<typeof loadConfig> }> {
  const { key } = await resolveApiKey({ explicit: flagStr(currentFlags, "api-key") });
  const cfg = loadConfig(key, overrides);
  const mcp = new CobraMcp(cfg.server);
  const sp = new Spinner("starting cobra-mcp server…");
  sp.start();
  try {
    await mcp.connect();
    sp.stop();
  } catch (err) {
    sp.stop();
    throw new Error(`Failed to start MCP server: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { mcp, cfg };
}

// Stash flags globally so connectMcp can read the api-key override.
let currentFlags: Record<string, string | boolean> = {};

async function cmdModels(f: Record<string, string | boolean>): Promise<void> {
  const { key } = await resolveApiKey({ explicit: flagStr(f, "api-key") });
  const cfg = loadConfig(key, {});
  const llm = new OpenRouter(cfg);
  const sp = new Spinner("fetching models…");
  sp.start();
  const models = await llm.listModels();
  sp.stop();
  const filter = flagStr(f, "filter")?.toLowerCase();
  const list = filter ? models.filter((m) => m.id.toLowerCase().includes(filter)) : models;
  process.stdout.write(`\n${list.length} models${filter ? ` matching "${filter}"` : ""}:\n\n`);
  for (const m of list) {
    const ctx = m.contextLength ? ` (${Math.round(m.contextLength / 1000)}k ctx)` : "";
    process.stdout.write(`  ${m.id}${ctx}\n`);
  }
  process.stdout.write("\n");
}

async function cmdSetup(f: Record<string, string | boolean>): Promise<void> {
  ui.info("CobraStrike client setup");
  // Model
  const current = loadConfig("placeholder", {});
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));
  const model = (await ask(`Model [${current.model}]: `)) || current.model;
  rl.close();
  writeFileConfig({ model });
  ui.ok(`Model set to ${model} (saved to ${configPath()})`);

  // Key
  const wantKey = f["save-key"] === true || (await confirm("Store an OpenRouter API key now?"));
  if (wantKey) {
    const key = await promptKeyHidden();
    saveKey(key);
    ui.ok(`Key stored at ${path.join(require_home(), ".config", "cobra", "credentials")} (mode 0600)`);
  } else {
    ui.info("Skipping key storage. Provide it via OPENROUTER_API_KEY or --api-key at runtime.");
  }
}

function require_home(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "~";
}

async function confirm(q: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(`${q} [y/N] `, (a) => {
      rl.close();
      res(/^y(es)?$/i.test(a.trim()));
    })
  );
}

async function cmdTools(overrides: CliOverrides): Promise<void> {
  const { mcp } = await connectMcp(overrides);
  try {
    const tools = await mcp.listTools();
    process.stdout.write(`\n${tools.length} tools from cobra-mcp:\n\n`);
    for (const t of tools) {
      process.stdout.write(`  ${t.name.padEnd(24)} ${t.description ?? ""}\n`);
    }
    process.stdout.write("\n");
  } finally {
    await mcp.close();
  }
}

async function cmdDoctor(overrides: CliOverrides): Promise<void> {
  ui.info("Running diagnostics…");
  // Key
  try {
    const { source } = await resolveApiKey({ explicit: flagStr(currentFlags, "api-key"), allowPrompt: false });
    ui.ok(`OpenRouter key resolved (source: ${source})`);
  } catch (err) {
    ui.err(err instanceof Error ? err.message : String(err));
  }
  // Server
  try {
    const { mcp } = await connectMcp(overrides);
    const tools = await mcp.listTools();
    ui.ok(`MCP server up — ${tools.length} tools available`);
    const target = await mcp.readResource("cobra://target").catch(() => "(unavailable)");
    ui.info(`Server target: ${target}`);
    await mcp.close();
  } catch (err) {
    ui.err(`MCP server: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function makeAgentEvents(verbose: boolean) {
  return {
    onAssistantText: (t: string) => ui.assistant(t),
    onToolCall: (name: string, args: Record<string, unknown>) => ui.tool(name, args),
    onToolResult: (_name: string, result: string) => {
      if (verbose) ui.toolResult(result);
    },
    onUsage: (tokens: number, turn: number) => ui.usage(tokens, turn),
  };
}

async function runTask(
  task: string,
  overrides: CliOverrides,
  missionText?: string
): Promise<void> {
  const { mcp, cfg } = await connectMcp(overrides);
  const verbose = currentFlags["verbose"] === true;
  try {
    ui.banner(cfg.model);
    const sp = new Spinner("gathering engagement context…");
    sp.start();
    const ctx = await gatherContext(mcp);
    const systemPrompt = buildSystemPrompt(ctx, missionText);
    sp.stop();

    const llm = new OpenRouter(cfg);
    const agent = new Agent(cfg, llm, mcp, makeAgentEvents(verbose));
    ui.info(`Task: ${task}`);
    const result = await agent.run(systemPrompt, task);
    process.stdout.write("\n");
    ui.ok(`Done in ${result.turns} messages • ${result.totalTokens} tokens`);
  } finally {
    await mcp.close();
  }
}

async function cmdChat(overrides: CliOverrides): Promise<void> {
  const { mcp, cfg } = await connectMcp(overrides);
  const verbose = currentFlags["verbose"] === true;
  try {
    ui.banner(cfg.model);
    const ctx = await gatherContext(mcp);
    const systemPrompt = buildSystemPrompt(ctx);
    const llm = new OpenRouter(cfg);
    const agent = new Agent(cfg, llm, mcp, makeAgentEvents(verbose));
    ui.ok("Agent ready. Type a task, or 'exit' to quit.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\nyou › " });
    rl.prompt();
    for await (const line of rl) {
      const task = line.trim();
      if (!task) {
        rl.prompt();
        continue;
      }
      if (/^(exit|quit|:q)$/i.test(task)) break;
      await agent.run(systemPrompt, task);
      rl.prompt();
    }
    rl.close();
  } finally {
    await mcp.close();
  }
}

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  currentFlags = flags;
  if (flags["help"] === true || flags["h"] === true) {
    process.stdout.write(HELP);
    return;
  }
  const overrides = cliOverrides(flags);

  switch (cmd) {
    case "models":
      await cmdModels(flags);
      break;
    case "setup":
      await cmdSetup(flags);
      break;
    case "tools":
      await cmdTools(overrides);
      break;
    case "doctor":
      await cmdDoctor(overrides);
      break;
    case "chat":
      await cmdChat(overrides);
      break;
    case "mission": {
      const file = positional[0];
      if (!file) {
        ui.err("mission requires a file path, e.g. cobra mission brain/missions/x.mission.md");
        process.exit(1);
      }
      const missionText = fs.readFileSync(path.resolve(file), "utf8");
      const task =
        flagStr(flags, "task") ??
        "Execute the mission described in the ACTIVE MISSION section. Begin with recon triage and proceed methodically toward the objective.";
      await runTask(task, overrides, missionText);
      break;
    }
    case "run":
    default: {
      const task = positional.join(" ").trim();
      if (task) {
        await runTask(task, overrides);
      } else {
        await cmdChat(overrides);
      }
      break;
    }
  }
}

main().catch((err) => {
  ui.err(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
