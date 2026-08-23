/**
 * Bundles cobra-mcp into a single self-contained ESM file (dist/cobra-mcp.js).
 * This is the artifact served from the website and fetched by install.sh so the
 * client can spawn the server on boxes with no repo checkout.
 * Node built-ins stay external; the MCP SDK is inlined.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["build/index.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/cobra-mcp.js",
  // The MCP SDK uses dynamic require() for Node built-ins; ESM output has no
  // `require`, so inject one via createRequire. Shebang stays on line 1.
  banner: {
    js: [
      'import { createRequire as __cobraCreateRequire } from "node:module";',
      "const require = __cobraCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  // Node built-ins stay external; everything else (the MCP SDK) gets inlined.
  external: [
    "node:*",
    "child_process", "fs", "path", "os", "crypto", "util", "stream",
    "readline", "events", "http", "https", "net", "tls", "url", "zlib",
    "buffer", "process", "tty", "worker_threads", "async_hooks", "module",
  ],
  allowOverwrite: true,
  logLevel: "info",
}).catch(() => process.exit(1));
