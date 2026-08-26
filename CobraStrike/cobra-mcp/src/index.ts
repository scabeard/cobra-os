#!/usr/bin/env node
/**
 * cobra-mcp — CobraStrike MCP server (stdio transport).
 *
 * Authorized use only. A scope guard (COBRA_ALLOWED_SCOPE) is enforced in code.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { probeCapabilities } from "./capabilities.js";
import { registerSessionTools } from "./tools/session.js";
import { registerReconTools } from "./tools/recon.js";
import { registerWebTools } from "./tools/web.js";
import { registerCredsTools } from "./tools/creds.js";
import { registerExploitTools } from "./tools/exploit.js";
import { registerPayloadTools } from "./tools/payload.js";
import { registerCaptureTools } from "./tools/capture.js";
import { registerLateralTools } from "./tools/lateral.js";
import { registerC2Tools } from "./tools/c2.js";
import { registerShellTools } from "./tools/shell.js";
import { registerBrainTools } from "./tools/brain.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import { stopAllSessions } from "./lib/sessions.js";
import { scopeSummary } from "./scope.js";

async function main(): Promise<void> {
  // Probe the runtime box for available tools before serving.
  await probeCapabilities();

  const server = new McpServer({
    name: "cobra-mcp",
    version: "0.1.0",
  });

  // Tools
  registerSessionTools(server);
  registerReconTools(server);
  registerWebTools(server);
  registerCredsTools(server);
  registerExploitTools(server);
  registerPayloadTools(server);
  registerCaptureTools(server);
  registerLateralTools(server);
  registerC2Tools(server);
  registerShellTools(server);
  registerBrainTools(server);

  // Read-side
  registerResources(server);
  registerPrompts(server);

  // Clean shutdown of any long-running sessions
  const cleanup = () => {
    stopAllSessions();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is the MCP channel)
  console.error(`🐍 cobra-mcp up. Scope: ${scopeSummary()}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
