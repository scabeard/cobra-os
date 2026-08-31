/**
 * Credential tools — hydra brute force, john, hashcat.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertInScope } from "../scope.js";
import { requireCapability } from "../capabilities.js";
import { runToLoot, resultText, resolveExecPrefix, assertNotUnroutedOnion, viaSuffix } from "../lib/exec.js";
import { startSession } from "../lib/sessions.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function registerCredsTools(server: McpServer): void {
  // creds_brute is SESSION-MANAGED: an online brute force against a real
  // service runs for minutes-to-hours, which would outlive the client's 60s
  // MCP request timeout (the -32001 "Request timed out" bug) if it blocked.
  // Start hydra as a session, return the id immediately, and let the agent
  // poll session_output / stop with session_kill. Full output → session log.
  server.tool(
    "creds_brute",
    "⚠️ LOUD. Online brute force (hydra), throttled to 4 tasks, stop on first hit. Session-managed: returns a session id immediately; poll with session_output (hydra prints '[service] host: ... login: <user> password: <pw>' on a hit), stop with session_kill. Full output → session log.",
    {
      host: z.string().describe("Target host (in scope)"),
      service: z.string().describe("Service: ssh, ftp, rdp, vnc, mysql, postgres, telnet, smb, http-get, etc."),
      user: z.string().describe("Username (or -L file via userFile)"),
      passlist: z.string().describe("Path to password wordlist"),
      port: z.number().optional().describe("Non-default port"),
      via: z.string().optional().describe(
        "Tunnel id from tunnel_socks_start — route the attack through that foothold via proxychains. Omit for direct."
      ),
      tor: z.boolean().optional().describe(
        "true = route through the system tor daemon (COBRA_PROXY, COBRA_ENABLE_PROXY=1). Required for .onion targets. Mutually exclusive with via."
      ),
    },
    async ({ host, service, user, passlist, port, via, tor }) => {
      assertNotUnroutedOnion(host, tor);
      assertInScope(host);
      const prefix = resolveExecPrefix({ via, tor });
      const hydra = requireCapability("hydra");
      const argv = [...prefix, hydra, "-t4", "-f", "-V", "-l", user, "-P", passlist];
      if (port) argv.push("-s", String(port));
      argv.push(`${service}://${host}`);
      const info = startSession(
        "brute",
        `hydra -t4 -f -l ${user} -P ${passlist}${port ? ` -s ${port}` : ""} ${service}://${host}${viaSuffix(via)}`,
        argv
      );
      return text(
        `🔨 creds_brute started — session ${info.id}\n` +
          `  hydra -t4 -f -l ${user} -P ${passlist} ${service}://${host}\n` +
          `  output: ${info.outputFile}\n` +
          `  Poll with session_output id="${info.id}" (a hit prints 'login: ${user} password: ...'). Stop with session_kill.`
      );
    }
  );

  server.tool(
    "creds_crack_john",
    "Crack a hash file with john (CPU). Output to loot file.",
    {
      hashfile: z.string().describe("Path to file containing hashes"),
      wordlist: z.string().optional().describe("Wordlist (default rockyou if present)"),
      format: z.string().optional().describe("john --format (e.g. sha512crypt, NT)"),
    },
    async ({ hashfile, wordlist, format }) => {
      const john = requireCapability("john");
      const wl = wordlist ?? "/usr/share/wordlists/rockyou.txt";
      const argv = [john, `--wordlist=${wl}`];
      if (format) argv.push(`--format=${format}`);
      argv.push(hashfile);
      const r = await runToLoot("creds_crack_john", argv, { timeoutMs: 60 * 60 * 1000 });
      return text(resultText("creds_crack_john", r));
    }
  );

  server.tool(
    "creds_crack_hashcat",
    "Crack a hash file with hashcat (GPU). Output to loot file.",
    {
      hashfile: z.string().describe("Path to file containing hashes"),
      mode: z.string().describe("hashcat -m mode (e.g. 0=MD5, 1000=NTLM, 1800=sha512crypt)"),
      wordlist: z.string().optional().describe("Wordlist (default rockyou if present)"),
    },
    async ({ hashfile, mode, wordlist }) => {
      const hashcat = requireCapability("hashcat");
      const wl = wordlist ?? "/usr/share/wordlists/rockyou.txt";
      const r = await runToLoot("creds_crack_hashcat", [hashcat, "-m", mode, hashfile, wl], { timeoutMs: 60 * 60 * 1000 });
      return text(resultText("creds_crack_hashcat", r));
    }
  );
}
