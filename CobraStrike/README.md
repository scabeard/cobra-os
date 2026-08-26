# 🐍 CobraStrike

**A red-team pentesting AI assistant.** Reads a mission plan, sets a target, runs standard
scripts and tools with all output to files, then reads those files to plan its next move —
root flag or whatever the mission demands.

> ⚠️ **Authorized use only.** CobraStrike is built for lab environments, CTFs, and
> engagements with explicit written authorization. A scope guard is baked into the MCP
> server — tools refuse targets outside `COBRA_ALLOWED_SCOPE`.

## What it is

- **Mission-driven** — drop a `*.mission.md` file in `brain/missions/`, the AI executes
- **Token-efficient** — scans write full output to loot files; the AI reads summaries and
  only pulls detail when it needs it
- **Self-updating brain** — `brain/BRAIN.md` tracks attack surface, creds, access, dead
  ends, and next moves across the engagement
- **Tradecraft library** — `tradecraft/` distills field-tested hack tricks into
  AI-consumable guides with a decision-tree index
- **Custom MCP server** — `cobra-mcp` exposes recon, web, creds, payload, exfil, capture,
  lateral movement (scope-gated `exec_ssh` + SOCKS tunnel routing), and relay C2 tools
  (gs-netcat beacons, shell-through-relay, NAT-proof SOCKS pivots) and a gated
  local-shell toolbox (`shell_run` on its own `COBRA_ENABLE_SHELL` knob) over
  stdio with a hard scope guard
- **Capability-aware** — probes the runtime box at startup and reports which tools exist
  (and what to install for the ones that don't)

## Layout

```
cobra-mcp/      custom MCP server (Node/TypeScript)
brain/          BRAIN.md living memory + mission files + playbooks
tradecraft/     distilled hack-tricks guides + decision-tree INDEX
scripts/        standard flow scripts (output → loot dir)
loot/           default loot directory (override with COBRA_LOOT_DIR)
BUILD_PLAN.md   master plan + tool↔package manifest
```

## Quick start

```bash
cd cobra-mcp
npm install
npm run build
```

Then register the server in your MCP settings (see `BUILD_PLAN.md` §3) and set
`COBRA_ALLOWED_SCOPE` to your lab range.

## Philosophy

Most pentest and CTF engagements follow a logical path. CobraStrike uses scripts and
common tools to carry out tests when automation is needed, reads output files when scans
complete to save tokens, and plans its next move from evidence. It can make files and
folders, use root when needed, and write its own tools when it wants a smarter way.

Built to become part of Cobra OS, loading from Cobra shell.
