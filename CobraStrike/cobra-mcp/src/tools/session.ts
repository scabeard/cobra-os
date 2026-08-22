/**
 * Session / context tools: target_set, target_get, loot_path.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setTarget, getTarget } from "../state.js";
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
}
