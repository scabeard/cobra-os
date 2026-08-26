/**
 * Session / context tools: target_set, target_get, loot_path.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setTarget, getTarget, listTargets, removeTarget, clearTargets } from "../state.js";
import { assertInScope } from "../scope.js";
import { CONFIG } from "../config.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function registerSessionTools(server: McpServer): void {
  server.tool(
    "target_set",
    "Set the active engagement target (IP or hostname). Must be within COBRA_ALLOWED_SCOPE.",
    { target: z.string().describe("IP address or hostname of the authorized target") },
    async ({ target }) => {
      assertInScope(target);
      setTarget(target);
      return text(`🎯 Active target set to: ${target}`);
    }
  );

  server.tool(
    "target_get",
    "Get the currently active engagement target.",
    {},
    async () => text(getTarget() ? `🎯 Active target: ${getTarget()}` : "No target set. Use target_set first.")
  );

  server.tool(
    "loot_path",
    "Get the directory where all tool output (loot) is written.",
    {},
    async () => text(`📁 Loot directory: ${CONFIG.lootDir}`)
  );

  server.tool(
    "target_list",
    "List all registered engagement targets (most-recent-first), marking the active one. Concurrent targets are first-class — recon on one doesn't clobber another.",
    {},
    async () => {
      const ts = listTargets();
      if (ts.length === 0) return text("No targets registered. Use target_set first.");
      const active = getTarget();
      const rows = ts.map((t) => `- ${t}${t === active ? "  🎯 (active)" : ""}`);
      return text(`## Targets (${ts.length})\n\n` + rows.join("\n"));
    }
  );

  server.tool(
    "target_clear",
    "Remove a target from the registry (or all with no argument). Clears the active target if it was removed.",
    { target: z.string().optional().describe("Target to remove; omit to clear all") },
    async ({ target }) => {
      if (target === undefined) {
        clearTargets();
        return text("🎯 All targets cleared.");
      }
      return text(
        removeTarget(target) ? `🎯 Removed target: ${target}` : `No such target registered: ${target}`
      );
    }
  );
}
