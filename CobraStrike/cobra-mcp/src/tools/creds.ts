/**
 * Credential tools — hydra brute force, john, hashcat.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertInScope } from "../scope.js";
import { requireCapability } from "../capabilities.js";
import { runToLoot, resultText, proxyPrefix } from "../lib/exec.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function registerCredsTools(server: McpServer): void {
  server.tool(
    "creds_brute",
    "⚠️ LOUD. Online brute force (hydra). Throttled to 4 tasks, stop on first hit. Output to loot file.",
    {
      host: z.string().describe("Target host (in scope)"),
      service: z.string().describe("Service: ssh, ftp, rdp, vnc, mysql, postgres, telnet, smb, http-get, etc."),
      user: z.string().describe("Username (or -L file via userFile)"),
      passlist: z.string().describe("Path to password wordlist"),
      port: z.number().optional().describe("Non-default port"),
      via: z.string().optional().describe(
        "Tunnel id from tunnel_socks_start — route the attack through that foothold via proxychains. Omit for direct."
      ),
    },
    async ({ host, service, user, passlist, port, via }) => {
      assertInScope(host);
      const prefix = proxyPrefix(via);
      const hydra = requireCapability("hydra");
      const argv = [...prefix, hydra, "-t4", "-f", "-V", "-l", user, "-P", passlist];
      if (port) argv.push("-s", String(port));
      argv.push(`${service}://${host}`);
      const r = await runToLoot("creds_brute", argv, { timeoutMs: 60 * 60 * 1000 });
      return text(resultText("creds_brute", r));
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
