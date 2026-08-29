/**
 * Mission tools — the agent-side read path for mission files.
 *
 * Why this exists (2026-08-28): MCP *resources* are not callable by the model
 * in the cobra-client agent loop — resources are gathered once client-side at
 * startup (cobra://missions listing only, not contents). The opshelp and the
 * engagement prompt both told the agent to "read cobra://missions/{file}",
 * which it cannot do mid-session, so it fell back to the gated shell_run just
 * to cat the mission file and reported a bogus blocker. mission_read is the
 * ungated, read-only, path-contained fix: same trust level as the existing
 * cobra://missions/{file} resource, but invocable as a tool.
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

export function registerMissionTools(server: McpServer): void {
  // The brain always sits next to missions/ (repo: brain/missions/; COBRA OS:
  // /etc/cobra/brain/missions/; install.sh: ~/.cobra/brain/missions/).
  const missionsDir = path.join(path.dirname(CONFIG.brainPath), "missions");

  server.tool(
    "mission_read",
    "Read a mission file from the missions directory (ungated, read-only, path-contained). Use this to load a mission's objective/scope/ROE when a task references a *.mission.md file by name and no ACTIVE MISSION was injected. Pass just the filename (hunter.mission.md) or a path under the missions dir. To run a mission with its content injected as ACTIVE MISSION, the operator should instead use: cobra mission <file>.",
    {
      file: z
        .string()
        .describe("Mission filename (e.g. hunter.mission.md) or a path under the missions directory"),
    },
    async ({ file }) => {
      const p = resolveContained(missionsDir, file);
      if (!p) return text(`⛔ mission_read: access denied — '${file}' escapes the missions directory (${missionsDir})`);
      let content: string;
      try {
        content = fs.readFileSync(p, "utf8");
      } catch {
        let available: string[] = [];
        try {
          available = fs.readdirSync(missionsDir).filter((f) => f.endsWith(".mission.md")).sort();
        } catch { /* no missions dir */ }
        return text(
          `⚠️ mission_read: not found: ${p}\n` +
            `Missions directory: ${missionsDir}\n` +
            (available.length
              ? `Available missions:\n${available.map((f) => `- ${f}`).join("\n")}`
              : "(no *.mission.md files — copy TEMPLATE.mission.md and fill it in)")
        );
      }
      if (!content.trim()) {
        return text(`⚠️ mission_read: ${path.basename(p)} is empty — tell the operator to fill it in from the template.`);
      }
      return text(`## Mission: ${path.basename(p)}\n\n${content}`);
    }
  );
}
