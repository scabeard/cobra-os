# 🐍 cobra-client — CobraStrike headless MCP client

A **self-contained, headless AI agent** that replaces Cline for driving the
`cobra-mcp` server. It spawns the server over stdio, connects as an MCP client,
and runs an autonomous agent loop powered by any model on **OpenRouter** — using
**your own API key**, kept secure.

Built for the CobraStrike project: authorized red-team engagements, driven by a
mission file, with a living brain and tradecraft doctrine.

---

## Why

- **Self-contained** — bundles to a single `cobra.js` you can host on your
  website and fetch with a one-liner. No Cline, no IDE, no MCP config JSON.
- **Your key, your model** — bring your own OpenRouter key; pick any model.
- **Secure by default** — the key is never written to disk unless you opt in,
  never echoed, and sent only to OpenRouter over HTTPS.
- **Same doctrine** — pulls the engagement prompt, opshelp, brain, and
  tradecraft from the MCP server, so it behaves exactly like the rest of COBRA.

---

## Install (from the COBRA OS site)

```bash
curl -fsSL https://cobra-os.com/cobra/install.sh | bash
# or over Tor, from the .onion mirror:
torsocks curl -fsSL http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/cobra/install.sh | bash
```

Then:

```bash
cobra setup --save-key     # store your OpenRouter key (mode 0600)
cobra models               # browse / pick a model
cobra doctor               # verify everything
```

> **Node.js ≥ 18** is required. COBRA OS ships no Node runtime, so the installer
> **installs it for you** if missing — via `apt` (Debian/Parrot) first, falling
> back to a static tarball from nodejs.org into `~/.cobra/node/`. It drops the
> client bundle **and** the `cobra-mcp` server bundle in `~/.cobra/`, a `cobra`
> launcher in `~/.local/bin/`, and points the client at the installed server via
> `~/.config/cobra/config.json` — so `cobra doctor` passes on a fresh box.

### Build from source instead

```bash
cd cobra-client
npm install
npm run bundle        # → dist/cobra.js (single self-contained file)
node dist/cobra.js doctor
```

---

## Usage

```
cobra <command> [options]
```

| Command | What it does |
|---|---|
| `run [task]` | Run a task headlessly; interactive chat if no task given |
| `mission <file>` | Execute a `brain/missions/*.mission.md` file |
| `chat` | Interactive REPL with the agent |
| `models` | List available OpenRouter models |
| `setup` | Configure model + securely store your OpenRouter key |
| `tools` | List tools exposed by the MCP server |
| `doctor` | Sanity-check server, API key, and connectivity |

### Common options

| Flag | Default | Purpose |
|---|---|---|
| `--model <id>` | `anthropic/claude-3.5-sonnet` | OpenRouter model id |
| `--api-key <key>` | — | Key (else env / saved / hidden prompt) |
| `--base-url <url>` | `https://openrouter.ai/api/v1` | Override endpoint (proxy/gateway) |
| `--scope <cidrs>` | — | Set `COBRA_ALLOWED_SCOPE` on the server |
| `--loot-dir <dir>` | `./loot` | Set `COBRA_LOOT_DIR` |
| `--max-turns <n>` | `40` | Agent loop iteration cap |
| `--temperature <n>` | `0.2` | Sampling temperature |
| `--max-tokens <n>` | `4096` | Max tokens per completion |
| `--verbose` | off | Stream full tool output |

### Examples

```bash
# One-shot headless task
cobra run "Recon triage the active target and update the brain"

# Execute a mission file with a specific model
cobra mission brain/missions/htb-blue.mission.md --model anthropic/claude-3.5-sonnet

# Interactive session
cobra chat

# Point at a different scope / loot dir
cobra run "…" --scope "10.10.10.0/24,lab.local" --loot-dir /dev/shm/cobra-loot
```

---

## Security model

- **API key** — resolved in this order: `--api-key` → `OPENROUTER_API_KEY` env →
  saved file → hidden interactive prompt. It is held only in memory and sent
  solely as an `Authorization: Bearer` header to the OpenRouter endpoint. It is
  **never logged** and **never written to disk** unless you run
  `cobra setup --save-key`, which stores it at `~/.config/cobra/credentials`
  with **mode 0600**.
- **Scope guard** — enforced **in the server**, not the client. Every
  network-touching tool validates its target against `COBRA_ALLOWED_SCOPE`;
  out-of-scope targets are refused in code. The client just passes the scope
  through to the server env.
- **Transport** — stdio only. No sockets exposed.

---

## How it works

```
┌────────────┐   stdio (MCP)   ┌─────────────┐
│ cobra      │ ──────────────▶ │ cobra-mcp   │  ← tools, scope guard, loot
│ client     │ ◀────────────── │ server      │
│ (agent)    │                 └─────────────┘
└─────┬──────┘
      │ HTTPS (OpenAI-compatible)
      ▼
┌─────────────┐
│ OpenRouter  │  ← your key, your model
└─────────────┘
```

1. `cobra` spawns `cobra-mcp` and connects as an MCP client.
2. It gathers engagement context (authorized-engagement prompt, opshelp, brain,
   target) and builds a system prompt.
3. The **agent loop** sends messages + tool schemas to the model; when the model
   requests tool calls, the client executes them against the server and feeds
   results back — until the model stops or hits `--max-turns`.
4. All tool output lands in loot files; the brain is updated after each phase.

---

## Hosting on the COBRA OS site

The site serves static files from `cobra-os.com/cobra/` (and the `.onion`
mirror), synced from this repo by `website/sync-cobra.sh`:

```
https://cobra-os.com/cobra/install.sh            # this repo's install.sh
https://cobra-os.com/cobra/latest/cobra.js       # client:  cobra-client/dist/cobra.js
https://cobra-os.com/cobra/latest/cobra-mcp.js   # server:  cobra-mcp/dist/cobra-mcp.js
```

`install.sh` downloads **both** bundles and wires up the `cobra` command,
configuring the client to spawn the installed `cobra-mcp.js` (no repo checkout
needed). To ship an update, edit the client or server, then run
`website/sync-cobra.sh` (it rebuilds each bundle if its `src/` is newer) and
commit the mirror — users re-run the installer to update.

---

## Authorized use only

CobraStrike is for **authorized** penetration testing and CTF/lab engagements.
The scope guard enforces authorization in code, but you are responsible for
ensuring you have explicit permission for every target.
