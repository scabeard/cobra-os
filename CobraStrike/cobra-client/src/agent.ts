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

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
        const args = parseArgs(call.function.arguments);
        this.events.onToolCall?.(name, args);

        let result: string;
        try {
          result = await this.mcp.callTool(name, args);
        } catch (err) {
          result = `TOOL ERROR: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.events.onToolResult?.(name, result);

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
