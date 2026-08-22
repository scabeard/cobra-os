/**
 * Payload & exfil tools — egg build, upserv, payload serve.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import { requireCapability } from "../capabilities.js";
import { runToLoot, resultText } from "../lib/exec.js";
import { startSession } from "../lib/sessions.js";
import { CONFIG } from "../config.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function registerPayloadTools(server: McpServer): void {
  server.tool(
    "payload_egg_build",
    "Build a self-extracting implant (mkegg.sh). Bundles files + a run-command into one script. Non-interactive.",
    {
      out: z.string().describe("Output egg script path"),
      files: z.array(z.string()).describe("Files/dirs to bundle"),
      cmd: z.string().describe("Command to run on extraction"),
    },
    async ({ out, files, cmd }) => {
      const mkegg = path.join(CONFIG.repoRoot, "scripts", "mkegg.sh");
      const r = await runToLoot("payload_egg_build", ["sh", mkegg, out, ...files, cmd]);
      return text(resultText("payload_egg_build", r));
    }
  );

  server.tool(
    "exfil_upserv_start",
    "Start an HTTP upload/download server (python3) bound to an address. Session-managed; returns a session ID.",
    {
      bind: z.string().describe("Bind address, e.g. 127.0.0.1 or 0.0.0.0"),
      port: z.number().describe("Port"),
      dir: z.string().optional().describe("Directory to serve (default: loot dir)"),
    },
    async ({ bind, port, dir }) => {
      const py = requireCapability("python3");
      const serveDir = dir ?? CONFIG.lootDir;
      const info = startSession("upserv", `python3 -m http.server ${port} --bind ${bind} (dir=${serveDir})`, [
        py, "-m", "http.server", String(port), "--bind", bind, "--directory", serveDir,
      ]);
      return text(`📡 upserv started — session ${info.id}\n  http://${bind}:${port}/  serving ${serveDir}\n  output: ${info.outputFile}`);
    }
  );

  server.tool(
    "payload_serve",
    "Serve the loot dir over HTTP for egg/payload delivery. Session-managed; returns a session ID.",
    { port: z.number().optional().describe("Port (default 8000)") },
    async ({ port }) => {
      const py = requireCapability("python3");
      const p = port ?? 8000;
      const info = startSession("serve", `python3 -m http.server ${p} (payload delivery)`, [
        py, "-m", "http.server", String(p), "--directory", CONFIG.lootDir,
      ]);
      return text(`📡 payload_serve started — session ${info.id}\n  http://0.0.0.0:${p}/  serving ${CONFIG.lootDir}\n  output: ${info.outputFile}`);
    }
  );
}
