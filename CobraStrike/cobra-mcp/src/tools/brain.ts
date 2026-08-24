/**
 * Brain tools — the write side of the living memory. The doctrine orders a
 * brain update after every phase; without these tools the agent cannot comply.
 * The brain path is fixed (CONFIG.brainPath) — no operator path input exists,
 * so there is nothing to traverse.
 */
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG } from "../config.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

export function registerBrainTools(server: McpServer): void {
  server.tool(
    "brain_write",
    "Replace the ENTIRE brain file with new markdown. Read cobra://brain first, fold in your updates, then write the complete document back. Use after every phase (target profile, attack surface, creds, access, next moves).",
    {
      content: z.string().describe("Full new brain markdown — the complete document, not a diff"),
    },
    async ({ content }) => {
      if (!content.trim()) {
        return text("⚠️ brain_write refused: empty content would wipe the brain. Send the full document.");
      }
      fs.mkdirSync(path.dirname(CONFIG.brainPath), { recursive: true });
      fs.writeFileSync(CONFIG.brainPath, content, "utf8");
      return text(`🧠 Brain written (${content.length} bytes) → ${CONFIG.brainPath}`);
    }
  );

  server.tool(
    "brain_append",
    "Append a terse dated note to the end of the brain (Lessons Learned lives last). For structured section updates use brain_write instead.",
    {
      note: z.string().describe("One-line markdown note to append"),
    },
    async ({ note }) => {
      if (!note.trim()) return text("⚠️ brain_append refused: empty note");
      fs.mkdirSync(path.dirname(CONFIG.brainPath), { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(CONFIG.brainPath, `\n- ${note.trim()} (${stamp})\n`, "utf8");
      return text(`🧠 Note appended → ${CONFIG.brainPath}`);
    }
  );
}
