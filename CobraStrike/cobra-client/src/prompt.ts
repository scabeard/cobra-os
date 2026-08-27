/**
 * System prompt assembly — pulls the engagement framing from the MCP server
 * (authorized-engagement prompt + opshelp + brain) so the agent operates with
 * the same doctrine as the rest of the CobraStrike project.
 */
import type { CobraMcp } from "./mcp.js";

export interface PromptContext {
  scope: string;
  target: string;
  brain: string;
  missions: string;
  opshelp: string;
  engagement: string;
}

async function safe(fn: () => Promise<string>, fallback: string): Promise<string> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function gatherContext(mcp: CobraMcp): Promise<PromptContext> {
  const [engagement, opshelp, brain, target, missions] = await Promise.all([
    safe(() => mcp.getPrompt("authorized-engagement"), ""),
    safe(() => mcp.readResource("cobra://opshelp"), ""),
    safe(() => mcp.readResource("cobra://brain"), "(no brain)"),
    safe(() => mcp.readResource("cobra://target"), "(no target)"),
    safe(() => mcp.readResource("cobra://missions"), "(no missions)"),
  ]);
  return { scope: "(via opshelp/prompt)", target, brain, missions, opshelp, engagement };
}

export function buildSystemPrompt(ctx: PromptContext, missionText?: string): string {
  const parts: string[] = [];

  parts.push(
    "You are CobraStrike — an autonomous, authorized red-team pentest agent. " +
      "You drive a custom MCP server of pentest tools. You are methodical, " +
      "evidence-driven, and token-efficient."
  );

  if (ctx.engagement) parts.push(ctx.engagement);

  parts.push(
    "OPERATING DOCTRINE:\n" +
      "- Work in phases: recon → enumeration → exploitation → privesc → objective.\n" +
      "- Every tool writes full output to loot files; read summaries, pull detail only as needed.\n" +
      "- NEVER retry anything logged under 'Attempted & Failed' in the brain.\n" +
      "- Update the brain after every phase using brain_write (full document) or brain_append (quick note): target profile, attack surface, creds, access, next moves.\n" +
      "- Consult tradecraft/ guides (cobra://tradecraft/{guide}) before using an unfamiliar technique.\n" +
      "- Stay strictly within authorized scope; the scope guard refuses out-of-scope targets.\n" +
      "- Think step by step, then act. Prefer one well-chosen tool over many speculative ones."
  );

  if (missionText) {
    parts.push(`ACTIVE MISSION:\n${missionText}`);
  }

  if (ctx.target) parts.push(`CURRENT STATE:\n${ctx.target}`);
  if (ctx.brain) parts.push(`BRAIN (living memory):\n${ctx.brain}`);
  if (ctx.missions) parts.push(`MISSION FILES:\n${ctx.missions}`);
  if (ctx.opshelp) parts.push(`TOOL REFERENCE:\n${ctx.opshelp}`);

  parts.push(
    "When the mission objective is met (or you are blocked), stop calling tools and " +
      "give a concise final report: what was achieved, evidence/loot paths, and recommended next steps."
  );

  return parts.join("\n\n---\n\n");
}
