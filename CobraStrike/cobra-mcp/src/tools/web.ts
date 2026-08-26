/**
 * Web tools — directory brute force, nikto, sqlmap.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertInScope } from "../scope.js";
import { requireCapability, capabilityPath } from "../capabilities.js";
import { runToLoot, resultText, proxyPrefix } from "../lib/exec.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
}

const viaArg = {
  via: z.string().optional().describe(
    "Tunnel id from tunnel_socks_start — route through that foothold via proxychains. Omit for direct."
  ),
};

export function registerWebTools(server: McpServer): void {
  server.tool(
    "web_dir_brute",
    "Directory brute force (ffuf, fallback gobuster). Finds hidden paths. Output to loot file.",
    {
      url: z.string().describe("Base URL, e.g. http://target/"),
      wordlist: z.string().optional().describe("Wordlist path (default: common.txt if present)"),
      ...viaArg,
    },
    async ({ url, wordlist, via }) => {
      assertInScope(hostFromUrl(url));
      const prefix = proxyPrefix(via);
      const wl = wordlist ?? "/usr/share/wordlists/dirb/common.txt";
      const ffuf = capabilityPath("ffuf");
      if (ffuf) {
        const r = await runToLoot("web_dir_brute", [...prefix, ffuf, "-u", `${url.replace(/\/$/, "")}/FUZZ`, "-w", wl, "-mc", "200,204,301,302,307,401,403"], { timeoutMs: 30 * 60 * 1000 });
        return text(resultText("web_dir_brute", r));
      }
      const gobuster = requireCapability("gobuster");
      const r = await runToLoot("web_dir_brute", [...prefix, gobuster, "dir", "-u", url, "-w", wl, "-q"], { timeoutMs: 30 * 60 * 1000 });
      return text(resultText("web_dir_brute", r));
    }
  );

  server.tool(
    "web_vuln_scan",
    "⚠️ NOISY. nikto web vulnerability scan. Output to loot file.",
    { url: z.string().describe("Target URL"), ...viaArg },
    async ({ url, via }) => {
      assertInScope(hostFromUrl(url));
      const prefix = proxyPrefix(via);
      const nikto = requireCapability("nikto");
      const r = await runToLoot("web_vuln_scan", [...prefix, nikto, "-h", url], { timeoutMs: 30 * 60 * 1000 });
      return text(resultText("web_vuln_scan", r));
    }
  );

  server.tool(
    "web_sql_inject",
    "SQL injection (sqlmap --batch). Provide a URL with an injectable parameter. Output to loot file.",
    {
      url: z.string().describe("URL with parameter, e.g. http://target/item.php?id=1"),
      level: z.string().optional().describe("sqlmap --level (1-5, default 1)"),
      risk: z.string().optional().describe("sqlmap --risk (1-3, default 1)"),
      ...viaArg,
    },
    async ({ url, level, risk, via }) => {
      assertInScope(hostFromUrl(url));
      const prefix = proxyPrefix(via);
      const sqlmap = requireCapability("sqlmap");
      const r = await runToLoot(
        "web_sql_inject",
        [...prefix, sqlmap, "-u", url, "--batch", "--level", level ?? "1", "--risk", risk ?? "1", "--output-dir", "/tmp/sqlmap-out"],
        { timeoutMs: 45 * 60 * 1000 }
      );
      return text(resultText("web_sql_inject", r));
    }
  );
}
