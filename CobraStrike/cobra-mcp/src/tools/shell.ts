/**
 * Local shell toolbox — gated generic local exec on the operator box.
 *
 * Phase 4 of the CobraStrike roadmap. `shell_run` executes an arbitrary bash
 * command through NON-INTERACTIVE bash (`bash -c`), e.g. assembling a payload,
 * post-processing loot, or driving a tool with no dedicated wrapper. This is
 * a deliberately wider blast radius than any other tool, so it has its OWN
 * gate: COBRA_ENABLE_SHELL=1 — separate from COBRA_ENABLE_TUNNELS, and never
 * forwarded from a cobrashell/cobra-ops interactive toggle.
 *
 * Design contract (mirrors c2_gs_shell):
 *   - sentinel exit-code parsing: `bash -c 'cmd; echo __COBRA_SH_RC__:$?'`
 *   - full stdout+stderr → loot file; bounded summary + exit code to the AI
 *   - optional `target=` (IP/host literal) is validated against scope
 *     pre-spawn, so a command's args can't smuggle out-of-scope targets while
 *     keeping in-scope documentation in the loot
 *   - the server env (incl. MCP-client env) applies, but the operator's login
 *     shell rc does NOT run. `shell_xhome_probe` reports which bastion pieces
 *     (xhome tmpfs dir, cobrashell path) are visible in THIS env, so the agent
 *     can decide whether to use cwd plumbing or just plain bash.
 *
 * Authorized use only: this runs on YOUR box. Gate it on deliberately.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertInScope } from "../scope.js";
import { CONFIG } from "../config.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const SH_MARK = "__COBRA_SH_RC__";
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 900;
const SUMMARY_LINES = 30;

interface ShResult {
  rc: number | null;
  output: string;
  lootFile: string;
  timedOut: boolean;
  durationMs: number;
}

/** Gate messages — the smoke harness pattern-matches on these. */
const GATE_OFF = "SHELL DISABLED: set COBRA_ENABLE_SHELL=1 on the server";
const GATE_HINT =
  " and restart. Arbitrary local exec is a separate blast radius from tunnels — gate it on only when you mean it.";

/**
 * Run `bash -c '<command>; echo __COBRA_SH_RC__:$?'` with output → loot.
 * Spawns bash directly with argv (no intermediate shell). Resolves on the
 * sentinel marker, process close, or timeout — the marker gives the command's
 * real exit code even when bash itself exits 0.
 */
function runSh(command: string, timeoutMs: number, cwd?: string): Promise<ShResult> {
  const bash = "bash"; // PATH lookup; bash always present on COBRA OS
  fs.mkdirSync(CONFIG.lootDir, { recursive: true });
  const file = path.join(
    CONFIG.lootDir,
    `shell_run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(
      bash,
      ["-c", `${command}; echo ${SH_MARK}:$?`],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        cwd: cwd ?? CONFIG.lootDir,
      }
    );
    const out = fs.createWriteStream(file, { flags: "a" });
    let captured = "";
    let rc: number | null = null;
    let settled = false;

    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      out.end();
      resolve({
        rc,
        output: captured.replace(new RegExp(`${SH_MARK}:\\d+\\s*$`), "").trim(),
        lootFile: file,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    const onData = (d: Buffer) => {
      out.write(d);
      if (captured.length < 256 * 1024) captured += d.toString();
      const m = captured.match(/__COBRA_SH_RC__:(\d+)/);
      if (m) {
        rc = Number(m[1]);
        finish(false);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      out.end();
      reject(new Error(`SPAWN ERROR running bash: ${err.message}`));
    });
    child.on("close", () => finish(false));
    const timer = setTimeout(() => finish(true), timeoutMs);
  });
}

export function registerShellTools(server: McpServer): void {
  server.tool(
    "shell_run",
    "Run an arbitrary bash command on the OPERATOR box (non-interactive `bash -c`, shell rc NOT loaded). For local work: payload assembly, loot post-processing, driving tools with no wrapper. Not for remote targets — use exec_ssh/c2_gs_shell for those. Gated by COBRA_ENABLE_SHELL=1 (default off, separate blast radius from tunnels). Optional `target=` (IP/host literal in the args) is scope-checked and recorded in the loot header. Output → loot file; summary + sentinel exit code returned.",
    {
      command: z.string().describe("Bash command, e.g. 'cd loot; msfvenom -p ... -o egg'"),
      target: z
        .string()
        .optional()
        .describe("IP/host literal appearing in the args — scope-checked pre-spawn"),
      timeout: z
        .number()
        .optional()
        .describe(`Seconds to wait (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S})`),
    },
    async ({ command, target, timeout }) => {
      if (!CONFIG.enableShell) {
        throw new Error(GATE_OFF + GATE_HINT);
      }
      if (target) assertInScope(target);
      const timeoutS = Math.min(timeout ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);
      const r = await runSh(command, timeoutS * 1000);
      const status = r.timedOut
        ? `TIMED OUT after ${timeoutS}s — partial output below`
        : r.rc === null
          ? "channel closed before the completion marker"
          : `exit ${r.rc}`;
      const lines = r.output.split("\n");
      const head = lines.slice(0, SUMMARY_LINES).join("\n");
      const more =
        lines.length > SUMMARY_LINES ? `\n… (${lines.length - SUMMARY_LINES} more lines in loot file)` : "";
      return text(
        `## shell_run — ${status} in ${(r.durationMs / 1000).toFixed(1)}s${target ? `  [re: ${target}]` : ""}\n\n` +
          (r.output ? head + more : "(no output)") +
          `\n\n📁 Full output: ${r.lootFile}`
      );
    }
  );

  server.tool(
    "shell_xhome_probe",
    "Report cobrashell xhome-bastion visibility from the SERVER's env (login shell rc does not run in the server): Is XHOME set and live? Is cobrashell.sh readable? Findings include the exact bash plumbing the operator agent should use (PATH prepend + mark-running) before using xhome as its bastion cwd. Ungated and read-only.",
    {},
    async () => {
      const xh = process.env.XHOME;
      let live = false;
      let details = "";
      if (xh) {
        try {
          const st = fs.statSync(xh);
          live = st.isDirectory();
          details = live ? "directory exists" : "set but not a directory";
        } catch {
          details = "set but not present on disk";
        }
      }
      const shCandidates = ["/etc/cobra/cobrashell.sh", "/usr/share/cobra/cobrashell.sh"]
        .filter((p) => {
          try {
            fs.accessSync(p, fs.constants.R_OK);
            return true;
          } catch {
            return false;
          }
        });
      const lines: string[] = [];
      lines.push(`XHOME env: ${xh ?? "(unset)"}`);
      lines.push(`XHOME live: ${live ? `yes (${details})` : `no (${details || "unset"})`}`);
      lines.push(
        `cobrashell.sh readable: ${shCandidates.length ? shCandidates.join(", ") : "(none found)"}`
      );
      lines.push("");
      if (live && xh) {
        lines.push(
          `Plumbing for bastion cwd (run via shell_run):\n` +
            `  export PATH="${xh}:${xh}/bin:$PATH"\n` +
            `  touch "${xh}/.run/$$"  # mark-running: xkeep-style, optional\n` +
            `  cd "${xh}" && <your command>`
        );
      } else {
        lines.push(
          "Bastion unavailable in this env — the /usr/local/bin/cobra launcher strips XHOME " +
            "(launch via an interactive cobrashell to inherit it), or just use plain bash cwd=loot."
        );
      }
      return text(lines.join("\n"));
    }
  );
}
