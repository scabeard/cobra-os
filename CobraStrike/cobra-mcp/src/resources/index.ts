/**
 * Resources — the read-side. Lets the AI self-discover usage, target, loot, sessions,
 * brain, tradecraft, capabilities, and the build plan.
 */
import fs from "node:fs";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG } from "../config.js";
import { getTarget, listSessions } from "../state.js";
import { capabilitiesMarkdown, profilesMarkdown } from "../capabilities.js";
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
- target_set <host>            register + activate a target (must be in scope)
- target_get                   show active target (most recently set)
- target_list                  all registered targets, active marked
- target_clear [host]          remove one target (or all)
- loot_path                    show loot directory
- recon_fast_scan [t]          nmap -T4 -F (top ports)
- recon_full_scan [t]          nmap -p- (all TCP)
- recon_service_scan ports [t] nmap -sV -sC -p ports
- recon_vuln_scan [t]          ⚠️ slow/noisy vulners
- recon_udp_scan [t]           UDP top-100 (sudo)
- recon_dns <name>             dig any
- recon_whois <target>         whois — egress-gated (COBRA_ALLOW_INTERNET=1 or tor=1)
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
- exec_ssh <h> <u> <cmd>       run a command on a host (password/key) — lateral exec
- ssh_key_setup <h> <u> <pw>   engagement keypair (loot dir) + pubkey install
- tunnel_socks_start <h> <u>   SOCKS5 through a foothold (ssh -D, COBRA_ENABLE_TUNNELS=1)
- tunnel_list / tunnel_stop    manage tunnels
- via=<tunnel-id>              route recon/web/creds tools through a tunnel (proxychains)
- tor=1                        route recon/web/creds + c2_gs_* through tor (COBRA_ENABLE_PROXY=1)
                                 .onion targets REQUIRE tor=1; add .onion to COBRA_ALLOWED_SCOPE
- c2_gs_secret                 generate a gsocket secret (local RNG, no gate)
- c2_gs_deploy [mode] [host..] gs beacon one-liner (+ optional ssh auto-deploy to /dev/shm)
- c2_gs_shell <beacon> <cmd>   run a command through the relay to a shell beacon
- c2_gs_socks_start <beacon>   SOCKS5 pivot through a socks beacon (via= ready)
- c2_gs_list                   beacons + tunnels dashboard (with cleanup commands)
- shell_run <cmd> [target]     local bash -c on the OPERATOR box (COBRA_ENABLE_SHELL=1)
- shell_xhome_probe            xhome-bastion env report (ungated, read-only)
- profile_list                 COBRA_PROFILES tool groups: installed vs missing (read-only)
- profile_check <name>         one group's binaries + rebuild hint (wireless|ad|exploit|webplus)
- session_list                 active sessions
- session_output <id>          tail session output
- session_kill <id>            stop session
- brain_write <md>             replace the brain (read cobra://brain first)
- brain_append <note>          append a dated note to the brain

## Missions
- Missions are markdown files in the missions dir (next to the brain).
- cobra://missions shows the exact directory, the template path, and the
  run command; cobra://missions/{file} reads one.
- Run one: cobra mission <path-to-file.mission.md> (xint first on COBRA OS).

All tool output → loot files. Read summaries; pull detail from files only as needed.
Update the brain after every phase (brain_write / brain_append).
`;

export function registerResources(server: McpServer): void {
  server.resource("opshelp", "cobra://opshelp", async (uri) =>
    textResource(uri.href, OPSHELP.replace("${SCOPE}", scopeSummary()))
  );

  server.resource("capabilities", "cobra://capabilities", async (uri) =>
    textResource(uri.href, capabilitiesMarkdown() + "\n" + profilesMarkdown())
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

  // Mission files — the agent must know where they live to tell the operator.
  // dir = dirname(brainPath)/missions: the brain always sits next to missions/
  // (repo: brain/missions/; COBRA OS: /etc/cobra/brain/missions/; install.sh:
  // ~/.cobra/brain/missions/). cobra://missions lists them; {file} reads one.
  const missionsDir = path.join(path.dirname(CONFIG.brainPath), "missions");
  server.resource("missions", "cobra://missions", async (uri) => {
    let files: string[] = [];
    try {
      files = fs.readdirSync(missionsDir).filter((f) => f.endsWith(".mission.md")).sort();
    } catch { /* no missions dir */ }
    const body = [
      `Mission directory: ${missionsDir}`,
      `Template: ${path.join(missionsDir, "TEMPLATE.mission.md")}`,
      `Run one: cobra mission ${path.join(missionsDir, "<name>.mission.md")}`,
      "",
      files.length ? files.map((f) => `- ${f}`).join("\n") : "- (no missions yet — copy the template)",
    ].join("\n");
    return textResource(uri.href, body);
  });
  server.resource(
    "mission",
    new ResourceTemplate("cobra://missions/{file}", {
      list: async () => {
        try {
          const files = fs.readdirSync(missionsDir).filter((f) => f.endsWith(".md"));
          return {
            resources: files.map((f) => ({
              uri: `cobra://missions/${f}`,
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
      const p = path.join(missionsDir, String(vars.file));
      if (!p.startsWith(missionsDir)) return textResource(uri.href, "(access denied)");
      return textResource(uri.href, readFileSafe(p));
    }
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
