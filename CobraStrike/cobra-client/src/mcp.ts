/**
 * MCP client bridge — spawns the cobra-mcp server over stdio and exposes its
 * tools/resources/prompts to the agent loop in an OpenAI-compatible shape.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServerSpec } from "./config.js";

export interface McpTool {
  name: string;
  description?: string;
  /** JSON schema for the tool arguments (passed straight to the model). */
  inputSchema: Record<string, unknown>;
}

export class CobraMcp {
  private client: Client;
  private transport: StdioClientTransport;
  private connected = false;

  constructor(private spec: ServerSpec) {
    this.client = new Client(
      { name: "cobra-client", version: "0.1.0" },
      { capabilities: {} }
    );
    this.transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: spec.env,
      cwd: spec.cwd,
      // Keep server stderr visible (it logs status there) but not on stdout.
      stderr: "inherit",
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.close();
    } catch {
      /* already closed */
    }
    this.connected = false;
  }

  /** Discover tools and convert to OpenAI tool-calling schema. */
  async listTools(): Promise<McpTool[]> {
    const res = await this.client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
    }));
  }

  /** Invoke a tool; returns the flattened text result. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.client.callTool({ name, arguments: args });
    const parts: string[] = [];
    const content = (res as { content?: unknown[] }).content ?? [];
    for (const c of content) {
      const item = c as { type?: string; text?: string };
      if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
      else parts.push(JSON.stringify(c));
    }
    const isErr = (res as { isError?: boolean }).isError;
    const body = parts.join("\n") || "(no output)";
    return isErr ? `TOOL ERROR:\n${body}` : body;
  }

  /** Read a server resource (brain, opshelp, target, capabilities, …). */
  async readResource(uri: string): Promise<string> {
    const res = await this.client.readResource({ uri });
    const parts: string[] = [];
    for (const c of res.contents) {
      const item = c as { text?: string; blob?: string };
      if (typeof item.text === "string") parts.push(item.text);
      else if (typeof item.blob === "string") parts.push(`[base64:${item.blob.length}b]`);
    }
    return parts.join("\n");
  }

  /** Fetch a workflow prompt scaffold from the server. */
  async getPrompt(name: string, args: Record<string, string> = {}): Promise<string> {
    const res = await this.client.getPrompt({ name, arguments: args });
    return res.messages
      .map((m) => {
        const c = m.content as { type?: string; text?: string };
        return c.type === "text" ? c.text ?? "" : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  async listPrompts(): Promise<{ name: string; description?: string }[]> {
    const res = await this.client.listPrompts();
    return res.prompts.map((p) => ({ name: p.name, description: p.description }));
  }
}
