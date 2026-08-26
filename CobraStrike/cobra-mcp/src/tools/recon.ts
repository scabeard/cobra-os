/**
 * Recon tools — nmap scans, dns, whois, smb enum.
 * All output → loot files; AI gets a summary + path.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertInScope } from "../scope.js";
import { requireCapability } from "../capabilities.js";
import { runToLoot, resultText, resolveExecPrefix, assertNotUnroutedOnion } from "../lib/exec.js";
import { getTarget } from "../state.js";
import { CONFIG } from "../config.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * Egress gate (Phase 7) for tools that reach the PUBLIC internet even when the
 * target itself is in scope — whois (public whois servers) and the vulners.nse
 * script (CVE API lookups). Refuse unless COBRA_ALLOW_INTERNET=1, or the call
 * is tor-routed (the operator already opted into exit-node egress via
 * COBRA_ENABLE_PROXY + tor=1).
 */
function assertEgressOk(tool: string, tor?: boolean): void {
  if (tor) return; // tor route is its own deliberate egress decision
  if (!CONFIG.allowInternet) {
    throw new Error(
      `EGRESS DENIED: ${tool} reaches the public internet (not just the in-scope target). ` +
        `Set COBRA_ALLOW_INTERNET=1, or route through tor (tor=1 + COBRA_ENABLE_PROXY=1).`
    );
  }
}

function resolveTarget(t?: string, tor?: boolean): string {
  const target = t ?? getTarget();
  if (!target) throw new Error("No target. Pass one explicitly or target_set first.");
  // Onion routing guard BEFORE scope: a .onion without tor=1 is unroutable —
  // that refusal is more actionable than a bare scope violation.
  assertNotUnroutedOnion(target, tor);
  assertInScope(target);
  return target;
}

export function registerReconTools(server: McpServer): void {
  const targetArg = { target: z.string().optional().describe("Target IP/host (defaults to active target)") };
  const viaArg = {
    via: z.string().optional().describe(
      "Tunnel id from tunnel_socks_start — route through that foothold via proxychains. Omit for direct."
    ),
    tor: z.boolean().optional().describe(
      "true = route through the system tor daemon (COBRA_PROXY, COBRA_ENABLE_PROXY=1). Required for .onion targets. Mutually exclusive with via."
    ),
  };

  server.tool(
    "recon_fast_scan",
    "Fast nmap scan (top ports, -T4 -F). Cheap first look. Output to loot file.",
    { ...targetArg, ...viaArg },
    async ({ target, via, tor }) => {
      const t = resolveTarget(target, tor);
      const nmap = requireCapability("nmap");
      const prefix = resolveExecPrefix({ via, tor });
      const r = await runToLoot("recon_fast_scan", [...prefix, nmap, "-n", "-Pn", "-T4", "-F", "--open", t]);
      return text(resultText("recon_fast_scan", r));
    }
  );

  server.tool(
    "recon_full_scan",
    "Full TCP port scan (nmap -p-). Slower but complete. Output to loot file.",
    { ...targetArg, ...viaArg },
    async ({ target, via, tor }) => {
      const t = resolveTarget(target, tor);
      const nmap = requireCapability("nmap");
      const prefix = resolveExecPrefix({ via, tor });
      const r = await runToLoot("recon_full_scan", [...prefix, nmap, "-n", "-Pn", "-p-", "--open", "-T4", t], { timeoutMs: 45 * 60 * 1000 });
      return text(resultText("recon_full_scan", r));
    }
  );

  server.tool(
    "recon_service_scan",
    "Service/version detection (nmap -sV -sC). Run against discovered ports. Output to loot file.",
    { ports: z.string().describe("Comma-separated ports, e.g. '22,80,443'"), ...targetArg, ...viaArg },
    async ({ ports, target, via, tor }) => {
      const t = resolveTarget(target, tor);
      const nmap = requireCapability("nmap");
      const prefix = resolveExecPrefix({ via, tor });
      const r = await runToLoot("recon_service_scan", [...prefix, nmap, "-n", "-Pn", "-sV", "-sC", "-p", ports, t], { timeoutMs: 20 * 60 * 1000 });
      return text(resultText("recon_service_scan", r));
    }
  );

  server.tool(
    "recon_vuln_scan",
    "⚠️ SLOW + NOISY. nmap vulners script. Confirm the mission allows noise. Output to loot file.",
    { ...targetArg, ...viaArg },
    async ({ target, via, tor }) => {
      const t = resolveTarget(target, tor);
      assertEgressOk("recon_vuln_scan", tor);
      const nmap = requireCapability("nmap");
      const prefix = resolveExecPrefix({ via, tor });
      const r = await runToLoot("recon_vuln_scan", [...prefix, nmap, "-Pn", "-sV", "--script", "vulners.nse", t], { timeoutMs: 30 * 60 * 1000 });
      return text(resultText("recon_vuln_scan", r));
    }
  );

  server.tool(
    "recon_udp_scan",
    "UDP scan (top 100 UDP ports). Requires sudo/root. Direct only — SOCKS tunnels carry TCP, so `via` is refused here. Output to loot file.",
    { ...targetArg, ...viaArg },
    async ({ target, via, tor }) => {
      if (via !== undefined || tor) {
        throw new Error("recon_udp_scan is direct-only: SOCKS tunnels and tor carry TCP, UDP can't ride them.");
      }
      const t = resolveTarget(target);
      const nmap = requireCapability("nmap");
      const r = await runToLoot("recon_udp_scan", [nmap, "-n", "-Pn", "-sU", "--top-ports", "100", "--open", t], { timeoutMs: 30 * 60 * 1000 });
      return text(resultText("recon_udp_scan", r));
    }
  );

  server.tool(
    "recon_dns",
    "DNS lookup (dig any + short). Output to loot file.",
    { name: z.string().describe("Hostname or domain to resolve") },
    async ({ name }) => {
      assertInScope(name);
      const dig = requireCapability("dig");
      const r = await runToLoot("recon_dns", [dig, name, "any"]);
      return text(resultText("recon_dns", r));
    }
  );

  server.tool(
    "recon_whois",
    "WHOIS lookup. Reaches public whois servers — egress-gated (COBRA_ALLOW_INTERNET=1 or tor=1). Output to loot file.",
    {
      target: z.string().describe("IP or domain"),
      tor: z.boolean().optional().describe(
        "true = route through the system tor daemon (COBRA_PROXY, COBRA_ENABLE_PROXY=1). Satisfies the egress gate."
      ),
    },
    async ({ target, tor }) => {
      assertNotUnroutedOnion(target, tor);
      assertInScope(target);
      assertEgressOk("recon_whois", tor);
      const whois = requireCapability("whois");
      const prefix = resolveExecPrefix({ tor });
      const r = await runToLoot("recon_whois", [...prefix, whois, target]);
      return text(resultText("recon_whois", r));
    }
  );

  server.tool(
    "recon_smb_enum",
    "SMB enumeration (nmap smb NSE: OS, shares, users). Output to loot file.",
    { ...targetArg, ...viaArg },
    async ({ target, via, tor }) => {
      const t = resolveTarget(target, tor);
      const nmap = requireCapability("nmap");
      const prefix = resolveExecPrefix({ via, tor });
      const r = await runToLoot("recon_smb_enum", [...prefix, nmap, "-n", "-Pn", "-p445", "--script", "smb-os-discovery,smb-enum-shares,smb-enum-users", t]);
      return text(resultText("recon_smb_enum", r));
    }
  );
}
