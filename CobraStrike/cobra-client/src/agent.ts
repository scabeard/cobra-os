/**
 * Agent loop — the headless engine.
 *
 * Cycle: send messages + tool schemas to the model → if it requests tool calls,
 * execute them against the MCP server, append results, repeat → until the model
 * stops calling tools or we hit maxTurns.
 */
import type { CobraMcp } from "./mcp.js";
import type { OpenRouter, ChatMessage, ToolSpec } from "./openrouter.js";
import type { ClientConfig } from "./config.js";

export interface AgentEvents {
  onAssistantText?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string) => void;
  onUsage?: (used: number, turn: number) => void;
}

export interface AgentResult {
  finalText: string;
  turns: number;
  totalTokens: number;
  messages: ChatMessage[];
}

function toToolSpecs(tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[]): ToolSpec[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

interface ArgsOk {
  ok: true;
  args: Record<string, unknown>;
  /** Optional non-fatal note (e.g. "empty arguments"). */
  note?: string;
}
interface ArgsErr {
  ok: false;
  error: string;
}

/**
 * Parse a tool-call argument payload. An empty payload is the empty-object
 * shorthand. A malformed/truncated payload returns { ok: false; error } —
 * never silently converted to {} — so the agent passes an explicit in-band
 * error back to the model instead of invoking the tool with {}.
 */
function parseArgs(raw: string): ArgsOk | ArgsErr {
  const t = raw.trim();
  if (t === "") return { ok: true, args: {} };
  if (t === "null") return { ok: true, args: {}, note: "arguments were the JSON literal null — treated as {}" };
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    // JSON.parse failed — payload is malformed (e.g. maxTokens truncated the
    // model's completion mid-JSON). Return an in-band error so the model can
    // see *why* the tool isn't running and resend.
    return { ok: false, error: `TOOL ARG PARSE ERROR: arguments are not valid JSON — probably truncated by maxTokens or malformed by the model. Payload starts: ${t.slice(0, 200)}${t.length > 200 ? "…" : ""}` };
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return { ok: true, args: v as Record<string, unknown> };
  }
  return { ok: false, error: `TOOL ARG PARSE ERROR: arguments are not a JSON object (got ${Array.isArray(v) ? "array" : typeof v}). Payload starts: ${t.slice(0, 200)}${t.length > 200 ? "…" : ""}` };
}



export class Agent {
  constructor(
    private cfg: ClientConfig,
    private llm: OpenRouter,
    private mcp: CobraMcp,
    private events: AgentEvents = {}
  ) {}

  async run(systemPrompt: string, userTask: string): Promise<AgentResult> {
    const tools = toToolSpecs(await this.mcp.listTools());
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userTask },
    ];

    let totalTokens = 0;
    let finalText = "";

    for (let turn = 1; turn <= this.cfg.maxTurns; turn++) {
      const res = await this.llm.chat(messages, tools);
      const msg = res.message;
      if (res.usage?.total_tokens) {
        totalTokens += res.usage.total_tokens;
        this.events.onUsage?.(totalTokens, turn);
      }

      // Record assistant message (with any tool calls).
      messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls,
      });

      if (msg.content) {
        finalText = msg.content;
        this.events.onAssistantText?.(msg.content);
      }

      // No tool calls → the model is done.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        break;
      }

      // Execute each requested tool against the MCP server.
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        const parsed = parseArgs(call.function.arguments);
        let result: string;
        if (!parsed.ok) {
          // Argument payload was malformed/truncated — don't hit the server
          // with {}; surface the parse error in-band so the model can resend.
          result = `TOOL ARG PARSE ERROR for ${name}: ${parsed.error}`;
          this.events.onToolCall?.(name, {});
          this.events.onToolResult?.(name, result);
        } else {
          const args = parsed.args;
          this.events.onToolCall?.(name, args);
          try {
            result = await this.mcp.callTool(name, args);
          } catch (err) {
            result = `TOOL ERROR: ${err instanceof Error ? err.message : String(err)}`;
          }
          this.events.onToolResult?.(name, result);
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    return { finalText, turns: messages.length, totalTokens, messages };
  }
}
