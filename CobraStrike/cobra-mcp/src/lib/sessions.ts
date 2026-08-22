/**
 * Session manager — long-running listeners/captures keyed by ID.
 * The server tracks PIDs and returns output-so-far instead of blind blocking.
 */
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";
import { registerSession, removeSession, getSession, SessionInfo } from "../state.js";

const procs = new Map<string, ChildProcess>();

function sessionOutputFile(id: string): string {
  fs.mkdirSync(CONFIG.lootDir, { recursive: true });
  return path.join(CONFIG.lootDir, `session-${id}.log`);
}

/** Start a long-running session. Returns the session ID. */
export function startSession(
  kind: SessionInfo["kind"],
  desc: string,
  argv: string[]
): SessionInfo {
  if (argv.length === 0) throw new Error("empty argv for session");
  const id = `${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
  const outputFile = sessionOutputFile(id);
  const out = fs.createWriteStream(outputFile, { flags: "a" });

  const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => out.write(d));
  child.stderr.on("data", (d) => out.write(d));
  child.on("close", () => out.end());

  const info: SessionInfo = {
    id,
    kind,
    pid: child.pid ?? -1,
    started: new Date().toISOString(),
    desc,
    outputFile,
  };
  procs.set(id, child);
  registerSession(info);
  return info;
}

/** Read output-so-far for a session. */
export function sessionOutput(id: string, tailLines = 50): string {
  const s = getSession(id);
  if (!s) throw new Error(`no such session: ${id}`);
  if (!fs.existsSync(s.outputFile)) return "(no output yet)";
  const content = fs.readFileSync(s.outputFile, "utf8");
  const lines = content.split("\n");
  return lines.slice(-tailLines).join("\n");
}

/** Stop a session (SIGTERM then SIGKILL). */
export function stopSession(id: string): boolean {
  const child = procs.get(id);
  const s = getSession(id);
  if (child) {
    try {
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 2000);
    } catch { /* already dead */ }
    procs.delete(id);
  }
  return s ? removeSession(id) : false;
}

/** Stop all sessions (server shutdown). */
export function stopAllSessions(): void {
  for (const id of [...procs.keys()]) stopSession(id);
}
