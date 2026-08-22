/**
 * OpenRouter provider — talks to the OpenAI-compatible chat completions API.
 *
 * Security notes:
 *  - The API key is held only in this object's private field, never logged,
 *    never written to disk, and sent only as an Authorization bearer header
 *    to the configured OpenRouter base URL.
 *  - All requests go over HTTPS to baseUrl (default https://openrouter.ai).
 */
import type { ClientConfig } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  message: ChatMessage;
  finishReason: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  pricingPrompt?: string;
  pricingCompletion?: string;
}

export class OpenRouter {
  constructor(private cfg: ClientConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.cfg.siteUrl) h["HTTP-Referer"] = this.cfg.siteUrl;
    if (this.cfg.siteName) h["X-Title"] = this.cfg.siteName;
    return h;
  }

  /** List available models from OpenRouter (for the model picker). */
  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.cfg.baseUrl}/models`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`OpenRouter /models failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      pricingPrompt: m.pricing?.prompt,
      pricingCompletion: m.pricing?.completion,
    }));
  }

  /** One chat completion round-trip (non-streaming, with tool calling). */
  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: this.cfg.temperature,
      max_tokens: this.cfg.maxTokens,
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter chat failed: ${res.status} — ${text}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      error?: { message?: string };
    };

    if (data.error) throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);
    const choice = data.choices?.[0];
    if (!choice?.message) throw new Error("OpenRouter returned no choices");

    const msg = choice.message;
    const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      message: {
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      },
      finishReason: choice.finish_reason ?? "stop",
      usage: data.usage,
    };
  }
}
