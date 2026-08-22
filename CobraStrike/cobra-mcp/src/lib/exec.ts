/**
 * exec wrapper — the token-saving output pattern.
 *
 * Runs a command, writes FULL output to a loot file, and returns only a
 * summary + loot path to the AI. The AI reads the file only if it needs detail.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";

export interface ExecResult {
  /** short human summary for the AI */
  summary: string;
  /** path to the full output loot file */
  lootFile: string;
  exitCode: number;
  durationMs: number;
}

function ensureLootDir(): void {
  fs.mkdirSync(CONFIG.lootDir, { recursive: true });
}

function lootPath(tool: string): string {
  ensureLootDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(CONFIG.lootDir, `${tool}-${ts}.log`);
}

/** Summarize output: first N non-empty lines + counts. */
function summarize(output: string, maxLines = 12): string {
  const lines = output.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const head = nonEmpty.slice(0, maxLines).join("\n");
  const more = nonEmpty.length > maxLines ? `\n… (${nonEmpty.length - maxLines} more lines in loot file)` : "";
  return head + more;
}

/**
 * Run a command (argv array, no shell) with output to loot.
 * Returns summary + loot path.
 */
export function runToLoot(
  tool: string,
  argv: string[],
  opts: { timeoutMs?: number; maxLines?: number } = {}
): Promise<ExecResult> {
  const { timeoutMs = 10 * 60 * 1000, maxLines = 12 } = opts;
  const file = lootPath(tool);
  const started = Date.now();

  return new Promise((resolve, reject) => {
    if (argv.length === 0) return reject(new Error("empty argv"));
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const out = fs.createWriteStream(file, { flags: "a" });
    let captured = "";

    child.stdout.on("data", (d) => {
      out.write(d);
      if (captured.length < 64 * 1024) captured += d.toString();
    });
    child.stderr.on("data", (d) => {
      out.write(d);
      if (captured.length < 64 * 1024) captured += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      out.end();
      reject(new Error(`TIMEOUT: ${tool} exceeded ${timeoutMs}ms. Partial output in ${file}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      out.end();
      reject(new Error(`SPAWN ERROR running ${argv[0]}: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      resolve({
        summary: summarize(captured, maxLines),
        lootFile: file,
        exitCode: code ?? -1,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Format an ExecResult as MCP text content. */
export function resultText(tool: string, r: ExecResult): string {
  return [
    `## ${tool} — exit ${r.exitCode} in ${(r.durationMs / 1000).toFixed(1)}s`,
    "",
    r.summary,
    "",
    `📁 Full output: ${r.lootFile}`,
  ].join("\n");
}
