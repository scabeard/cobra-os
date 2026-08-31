/**
 * Prompts — workflow scaffolding for common engagement flows.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scopeSummary } from "../scope.js";

function promptText(s: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text: s } }] };
}

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "authorized-engagement",
    "System-prompt fragment: consent/contract framing + scope-confirmed tool gating.",
    {},
    async () =>
      promptText(
        `You are CobraStrike, an authorized red-team pentest assistant.\n\n` +
          `AUTHORIZATION FRAMING:\n` +
          `- Act ONLY on targets within the authorized scope: ${scopeSummary()}\n` +
          `- The scope guard enforces this in code; do not attempt to bypass it.\n` +
          `- Every action must be consistent with the engagement's rules of engagement.\n\n` +
          `WORKFLOW:\n` +
          `1. Get the mission — if an ACTIVE MISSION section is in your context, that IS the mission (already injected; do NOT re-read the file). Otherwise use the mission_read tool to load one by name (mission files are listed in your context under MISSION FILES), then mission_begin to seed it into the brain.\n` +
          `2. Set the target (target_set) — it must be in scope.\n` +
          `3. Run standard tools; all output goes to loot files.\n` +
          `4. Read loot summaries; pull detail only as needed.\n` +
          `5. Update the brain after every phase — brain_read first (your context snapshot is stale), then brain_write (full document) or brain_append (quick note).\n` +
          `6. Consult tradecraft/ guides for techniques (cobra://tradecraft/{guide}).\n` +
          `7. Plan the next move from evidence toward the mission objective.`
      )
  );

  server.prompt(
    "recon-triage",
    "Pick scan depth from fscan → portscan → svcscan progression.",
    { target: z.string().optional() },
    async ({ target }) =>
      promptText(
        `Run recon triage${target ? ` against ${target}` : " against the active target"} (must be in scope: ${scopeSummary()}).\n\n` +
          `Follow brain/playbooks/recon-triage.md:\n` +
          `1. recon_fast_scan (top ports)\n` +
          `2. recon_full_scan if few ports or completeness needed\n` +
          `3. recon_service_scan on discovered ports\n` +
          `4. Targeted enum (smb/dns/web) based on findings\n` +
          `5. recon_vuln_scan only if noise is acceptable\n\n` +
          `Update the brain Attack Surface Map after each scan.`
      )
  );

  server.prompt(
    "web-assessment",
    "webdir → webvuln → sql sequencing.",
    { url: z.string() },
    async ({ url }) =>
      promptText(
        `Run a web assessment against ${url} (host must be in scope: ${scopeSummary()}).\n\n` +
          `Follow brain/playbooks/web-assessment.md:\n` +
          `1. Fingerprint server/framework\n` +
          `2. web_dir_brute for hidden paths\n` +
          `3. web_vuln_scan (nikto) if noise allowed\n` +
          `4. Probe forms/params/upload\n` +
          `5. web_sql_inject (sqlmap) on injectable params\n` +
          `6. exploit_search for identified versions\n\n` +
          `Record endpoints and findings in the brain.`
      )
  );

  server.prompt(
    "credential-attack",
    "Scope check reminder → hydra/john/hashcat.",
    {
      host: z.string(),
      service: z.string().optional(),
    },
    async ({ host, service }) =>
      promptText(
        `Run a credential attack against ${host}${service ? ` (${service})` : ""}.\n\n` +
          `⚠️ SCOPE CHECK: confirm ${host} ∈ ${scopeSummary()} before any attempt.\n\n` +
          `Follow brain/playbooks/credential-attack.md:\n` +
          `1. Choose targeted wordlists (tradecraft/07)\n` +
          `2. creds_brute (hydra, throttled -t4, -f) — session-managed; poll session_output for a hit, session_kill when done\n` +
          `3. Offline crack hashes: creds_crack_john / creds_crack_hashcat\n` +
          `4. Validate all cracked creds; record in brain Credentials\n\n` +
          `Log every attempt in brain Attempted & Failed.`
      )
  );
}
