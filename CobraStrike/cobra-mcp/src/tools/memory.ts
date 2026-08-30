/**
 * Memory tools — close the read/seed gaps in the brain loop (Phase 9, 2026-08-30).
 *
 * Why these exist:
 * - The brain (BRAIN.md) is the engagement's ONLY cross-run memory, but the
 *   agent could never re-read it mid-session: MCP resources are gathered once
 *   client-side at startup, so a brain written five turns ago was stale in the
 *   model's context. brain_read is the tool-callable read path — the exact
 *   mission_read precedent (resources are not model-callable in this loop).
 * - The mission file was injected into the system prompt but never landed IN
 *   the brain — the `## Mission` section stayed the template placeholder
 *   unless the model volunteered to fill it. mission_begin seeds it
 *   deterministically (the client calls it before the agent starts; the model
 *   may also call it when told to run a mission file mid-session).
 */
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG } from "../config.js";
import { resolveContained } from "../resources/index.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * Splice the brain's `## Mission` section: everything from the `## Mission`
 * heading up to (but excluding) the next `---` rule or `## ` heading is
 * replaced with `missionSection`. Falls back to prepending when the template
 * structure isn't found — a non-template brain still gets the mission.
 */
function spliceMission(brain: string, missionSection: string): string {
  const lines = brain.split("\n");
  const start = lines.findIndex((l) => /^## Mission\s*$/.test(l.trim()));
  if (start === -1) return `${missionSection}\n\n---\n\n${brain}`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), missionSection, "", ...lines.slice(end)].join("\n");
}

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "brain_read",
    "Read the CURRENT brain from disk (ungated, read-only). The brain copy in your context is a startup snapshot — it goes STALE after every brain_write/brain_append. Re-read with this tool before planning from memory, before a brain_write (fold in what's actually there), and to verify your writes landed.",
    {},
    async () => {
      try {
        return text(fs.readFileSync(CONFIG.brainPath, "utf8"));
      } catch {
        return text(
          `⚠️ brain_read: not found: ${CONFIG.brainPath}\n` +
            `The brain has not been created yet — seed it with brain_write (or run a mission: mission_begin seeds the Mission section).`
        );
      }
    }
  );

  server.tool(
    "mission_begin",
    "Start a mission deterministically: read a mission file (path-contained, same trust as mission_read) and seed its objective into the brain's Mission section — no more `*(none loaded)*`. Call this BEFORE recon whenever the operator points you at a *.mission.md file (the `cobra mission` CLI does it automatically). Records the mission file, the mission text, and a dated start note; appends a Lessons Learned line if no Mission section exists.",
    {
      file: z
        .string()
        .describe("Mission filename (e.g. hunter.mission.md) or a path under the missions directory"),
    },
    async ({ file }) => {
      const missionsDir = path.join(path.dirname(CONFIG.brainPath), "missions");
      const p = resolveContained(missionsDir, file);
      if (!p) {
        return text(`⛔ mission_begin: access denied — '${file}' escapes the missions directory (${missionsDir})`);
      }
      let content: string;
      try {
        content = fs.readFileSync(p, "utf8");
      } catch {
        let available: string[] = [];
        try {
          available = fs.readdirSync(missionsDir).filter((f) => f.endsWith(".mission.md")).sort();
        } catch { /* no missions dir */ }
        return text(
          `⚠️ mission_begin: not found: ${p}\n` +
            `Missions directory: ${missionsDir}\n` +
            (available.length
              ? `Available missions:\n${available.map((f) => `- ${f}`).join("\n")}`
              : "(no *.mission.md files — copy TEMPLATE.mission.md and fill it in)")
        );
      }
      if (!content.trim()) {
        return text(`⚠️ mission_begin: ${path.basename(p)} is empty — tell the operator to fill it in from the template.`);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const missionSection = [
        "## Mission",
        `- **Mission file:** ${path.basename(p)} (started ${stamp})`,
        "",
        content.trimEnd(),
      ].join("\n");

      let brain: string;
      try {
        brain = fs.readFileSync(CONFIG.brainPath, "utf8");
      } catch {
        brain = "";
      }
      const next = brain.trim()
        ? spliceMission(brain, missionSection)
        : `# 🧠 CobraStrike Brain\n\n${missionSection}\n`;

      fs.mkdirSync(path.dirname(CONFIG.brainPath), { recursive: true });
      fs.writeFileSync(CONFIG.brainPath, next, "utf8");
      const note = `Mission started: ${path.basename(p)}`;
      fs.appendFileSync(CONFIG.brainPath, `\n- ${note} (${stamp})\n`, "utf8");

      return text(
        `🧠 Mission seeded into brain → ${CONFIG.brainPath}\n` +
          `The brain Mission section now carries the objective; execute it methodically and update the brain after every phase.\n\n` +
          `## Mission: ${path.basename(p)}\n\n${content}`
      );
    }
  );
}
