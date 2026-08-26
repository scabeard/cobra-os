/**
 * Capture & listener tools — session-managed. Start returns an ID; poll output; stop by ID.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireCapability } from "../capabilities.js";
import { startSession, sessionOutput, stopSession } from "../lib/sessions.js";
import { listSessions } from "../state.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function registerCaptureTools(server: McpServer): void {
  server.tool(
    "listen_start",
    "Start a netcat reverse-shell listener. Session-managed; returns a session ID. Poll with session_output.",
    { port: z.number().describe("Port to listen on") },
    async ({ port }) => {
      const nc = requireCapability("nc");
      const info = startSession("listen", `nc -lvnp ${port}`, [nc, "-lvnp", String(port)]);
      return text(`👂 Listener started — session ${info.id}\n  nc -lvnp ${port}\n  output: ${info.outputFile}\n  Poll with session_output, stop with session_kill.`);
    }
  );

  server.tool(
    "capture_sniff_start",
    "Start tcpdump sniffing. Session-managed; returns a session ID.",
    {
      iface: z.string().describe("Interface, e.g. eth0"),
      filter: z.string().optional().describe("BPF filter, e.g. 'tcp port 80'"),
    },
    async ({ iface, filter }) => {
      const tcpdump = requireCapability("tcpdump");
      const argv = [tcpdump, "-i", iface, "-nn", "-q", ...(filter ? [filter] : [])];
      const info = startSession("sniff", `tcpdump -i ${iface} ${filter ?? ""}`, argv);
      return text(`🔍 Sniffer started — session ${info.id}\n  output: ${info.outputFile}`);
    }
  );

  server.tool(
    "capture_pcap_start",
    "Start tshark pcap capture. Session-managed; returns a session ID.",
    {
      iface: z.string().describe("Interface"),
      outfile: z.string().describe("Output .pcap path"),
      filter: z.string().optional().describe("Capture filter"),
    },
    async ({ iface, outfile, filter }) => {
      const tshark = requireCapability("tshark");
      const argv = [tshark, "-i", iface, "-w", outfile];
      if (filter) argv.push("-f", filter);
      const info = startSession("pcap", `tshark -i ${iface} -w ${outfile}`, argv);
      return text(`📦 PCAP capture started — session ${info.id}\n  writing ${outfile}\n  log: ${info.outputFile}`);
    }
  );

  server.tool(
    "session_list",
    "List all active capture/listen sessions.",
    {},
    async () => {
      const ss = listSessions();
      if (ss.length === 0) return text("No active sessions.");
      const rows = ss.map((s) => `- ${s.id} [${s.kind}] pid=${s.pid} started=${s.started}\n    ${s.desc}\n    output: ${s.outputFile}`);
      return text(`## Active sessions (${ss.length})\n\n` + rows.join("\n"));
    }
  );

  server.tool(
    "session_output",
    "Read output-so-far from a session (tail).",
    {
      id: z.string().describe("Session ID"),
      tail: z.number().optional().describe("Lines to tail (default 50)"),
    },
    async ({ id, tail }) => text(sessionOutput(id, tail ?? 50))
  );

  server.tool(
    "session_kill",
    "Stop a session by ID (SIGTERM then SIGKILL).",
    { id: z.string().describe("Session ID") },
    async ({ id }) => text(stopSession(id) ? `🛑 Session ${id} stopped.` : `No such session: ${id}`)
  );

  // stop aliases matching the spec's start/stop naming
  server.tool("capture_sniff_stop", "Stop a sniff session by ID.", { id: z.string() }, async ({ id }) =>
    text(stopSession(id) ? `🛑 Sniff session ${id} stopped.` : `No such session: ${id}`)
  );
  server.tool("capture_pcap_stop", "Stop a pcap session by ID.", { id: z.string() }, async ({ id }) =>
    text(stopSession(id) ? `🛑 PCAP session ${id} stopped.` : `No such session: ${id}`)
  );
  server.tool("listen_stop", "Stop a listener session by ID.", { id: z.string() }, async ({ id }) =>
    text(stopSession(id) ? `🛑 Listener ${id} stopped.` : `No such session: ${id}`)
  );
}
