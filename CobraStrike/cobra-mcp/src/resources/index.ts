/**
 * Resources — the read-side. Lets the AI self-discover usage, target, loot, sessions,
 * brain, tradecraft, capabilities, and the build plan.
 */
import fs from "node:fs";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG } from "../config.js";
import { getTarget, listSessions } from "../state.js";
import { capabilitiesMarkdown } from "../capabilities.js";
import { scopeSummary } from "../scope.js";

function textResource(uri: string, text: string) {
  return { contents: [{ uri, text }] };
}

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return `(not found: ${p})`;
  }
}

const OPSHELP = `# cobra-mcp opshelp

Scope: ${"${SCOPE}"}

## Tools
- target_set <host>            set active target (must be in scope)
- target_get                   show active target
- loot_path                    show loot directory
- recon_fast_scan [t]          nmap -T4 -F (top ports)
- recon_full_scan [t]          nmap -p- (all TCP)
- recon_service_scan ports [t] nmap -sV -sC -p ports
- recon_vuln_scan [t]          ⚠️ slow/noisy vulners
- recon_udp_scan [t]           UDP top-100 (sudo)
- recon_dns <name>             dig any
- recon_whois <target>         whois
- recon_smb_enum [t]           smb NSE enum
- web_dir_brute <url> [wl]     ffuf/gobuster
- web_vuln_scan <url>          ⚠️ nikto
- web_sql_inject <url>         sqlmap --batch
- creds_brute <h> <s> <u> <wl> ⚠️ hydra (throttled)
- creds_crack_john <hashfile>  john
- creds_crack_hashcat <f> <m>  hashcat
- exploit_search <terms>       searchsploit (offline)
- local_privesc [path]         linpeas (local)
- payload_egg_build <o> <f..>  mkegg self-extractor
- exfil_upserv_start <b> <p>   http up/download server
- payload_serve [port]         serve loot dir
- listen_start <port>          nc listener (session)
- capture_sniff_start <iface>  tcpdump (session)
- capture_pcap_start <i> <o>   tshark (session)
- session_list                 active sessions
- session_output <id>          tail session output
- session_kill <id>            stop session

All tool output → loot files. Read summaries; pull detail from files only as needed.
Update brain/BRAIN.md after every phase.
`;

export function registerResources(server: McpServer): void {
  server.resource("opshelp", "cobra://opshelp", async (uri) =>
    textResource(uri.href, OPSHELP.replace("${SCOPE}", scopeSummary()))
  );

  server.resource("capabilities", "cobra://capabilities", async (uri) =>
    textResource(uri.href, capabilitiesMarkdown())
  );

  server.resource("target", "cobra://target", async (uri) =>
    textResource(uri.href, getTarget() ? `Active target: ${getTarget()}` : "No target set.")
  );

  server.resource("sessions", "cobra://sessions", async (uri) => {
    const ss = listSessions();
    const body = ss.length === 0
      ? "No active sessions."
      : ss.map((s) => `- ${s.id} [${s.kind}] pid=${s.pid} — ${s.desc}`).join("\n");
    return textResource(uri.href, body);
  });

  server.resource("brain", "cobra://brain", async (uri) =>
    textResource(uri.href, readFileSafe(CONFIG.brainPath))
  );

  server.resource("buildplan", "cobra://buildplan", async (uri) =>
    textResource(uri.href, readFileSafe(path.join(CONFIG.repoRoot, "BUILD_PLAN.md")))
  );

  // loot file tree + individual files
  server.resource(
    "loot",
    new ResourceTemplate("cobra://loot/{path}", {
      list: async () => {
        try {
          const files = fs.readdirSync(CONFIG.lootDir);
          return {
            resources: files.map((f) => ({
              uri: `cobra://loot/${f}`,
              name: f,
              mimeType: "text/plain",
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    async (uri, vars) => {
      const p = path.join(CONFIG.lootDir, String(vars.path));
      // prevent path escape
      if (!p.startsWith(CONFIG.lootDir)) return textResource(uri.href, "(access denied)");
      return textResource(uri.href, readFileSafe(p));
    }
  );

  // tradecraft guides
  server.resource(
    "tradecraft",
    new ResourceTemplate("cobra://tradecraft/{guide}", {
      list: async () => {
        try {
          const files = fs.readdirSync(CONFIG.tradecraftDir).filter((f) => f.endsWith(".md"));
          return {
            resources: files.map((f) => ({
              uri: `cobra://tradecraft/${f}`,
              name: f,
              mimeType: "text/markdown",
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    async (uri, vars) => {
      const p = path.join(CONFIG.tradecraftDir, String(vars.guide));
      if (!p.startsWith(CONFIG.tradecraftDir)) return textResource(uri.href, "(access denied)");
      return textResource(uri.href, readFileSafe(p));
    }
  );
}
