/**
 * Profile wrappers — Phase 6 of the CobraStrike roadmap.
 *
 * Surfaces the OS-side COBRA_PROFILES tool groups (wireless / ad / exploit /
 * webplus) to the agent as a read-only discovery layer. The agent can see
 * which optional tool sets are present on the runtime box, which binaries are
 * missing, and exactly what to tell the operator to rebuild with.
 *
 * Read-only by design: the agent NEVER auto-installs a profile (prime
 * directive — minimalism first, every package justified). It reports and
 * recommends; the operator rebuilds. No gate — nothing here touches the
 * network or the filesystem beyond the startup capability probe.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { probeProfiles, profileStatus, PROFILE_MAP } from "../capabilities.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function statusLine(installed: string[], missing: string[]): string {
  if (missing.length === 0) return "✅ full";
  if (installed.length > 0) return "🟡 partial";
  return "❌ absent";
}

export function registerProfileTools(server: McpServer): void {
  server.tool(
    "profile_list",
    "List the COBRA_PROFILES OS tool groups (wireless / ad / exploit / webplus) with availability: which binaries are installed vs missing on this box, and the rebuild hint for any absent group. Read-only — the agent never auto-installs a profile.",
    {},
    async () => {
      const ps = probeProfiles();
      const lines: string[] = ["## COBRA_PROFILES tool groups", ""];
      for (const p of ps) {
        lines.push(`- **${p.name}** — ${p.desc}`);
        lines.push(`    status: ${statusLine(p.installed, p.missing)}`);
        lines.push(`    installed: ${p.installed.join(", ") || "—"}`);
        lines.push(`    missing:   ${p.missing.join(", ") || "—"}`);
        if (p.missing.length > 0) {
          lines.push(`    add with:  COBRA_PROFILES="${p.name}" (rebuild) → apt: ${p.packages}`);
        }
        if (p.note) lines.push(`    note: ${p.note}`);
        lines.push("");
      }
      lines.push(
        "_Profiles are OS build-time groups. The agent reports and recommends; the operator rebuilds. Nothing here is auto-installed._"
      );
      return text(lines.join("\n"));
    }
  );

  server.tool(
    "profile_check",
    "Check one COBRA_PROFILES group by name (wireless | ad | exploit | webplus): installed/missing binaries, the exact rebuild command, and scope/OPSEC notes for using it. Read-only.",
    {
      name: z.enum(["wireless", "ad", "exploit", "webplus"]).describe("Profile name"),
    },
    async ({ name }) => {
      const p = profileStatus(name);
      if (!p) {
        // zod enum already constrains this, but be defensive.
        return text(`Unknown profile: ${name}. Known: ${Object.keys(PROFILE_MAP).join(", ")}`);
      }
      const lines: string[] = [];
      lines.push(`## profile: ${p.name} — ${p.desc}`);
      lines.push(`status: ${statusLine(p.installed, p.missing)}`);
      lines.push(`installed: ${p.installed.join(", ") || "—"}`);
      lines.push(`missing:   ${p.missing.join(", ") || "—"}`);
      if (p.missing.length > 0) {
        lines.push("");
        lines.push(`To enable: rebuild the OS with this profile, e.g.`);
        lines.push(`  COBRA_PROFILES="${p.name}" ./build-iso.sh   (or add to an existing build)`);
        lines.push(`  packages: ${p.packages}`);
      } else {
        lines.push("");
        lines.push("All binaries present — this profile is usable now.");
      }
      if (p.note) {
        lines.push("");
        lines.push(`⚠️ ${p.note}`);
      }
      return text(lines.join("\n"));
    }
  );
}
