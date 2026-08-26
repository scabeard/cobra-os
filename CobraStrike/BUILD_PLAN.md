# CobraStrike — Build Plan

> **Authorized use only.** CobraStrike is a red-team / pentest automation assistant built for
> engagements where you have explicit written authorization. Every network-touching tool is
> gated by a scope guard (`COBRA_ALLOWED_SCOPE`). If it's out of scope, it doesn't run.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AI (KAT-Coder Pro v2.5 via OpenRouter — cobra-client)                    │
│  ├── reads mission file (brain/missions/*.mission.md)       │
│  ├── drives cobra-mcp tools                                 │
│  ├── reads scan output from loot files (token-efficient)    │
│  ├── updates brain/BRAIN.md after every phase               │
│  └── consults tradecraft/ guides for techniques             │
└──────────────────────┬──────────────────────────────────────┘
                       │ stdio (MCP)
┌──────────────────────▼──────────────────────────────────────┐
│  cobra-mcp (Node/TypeScript MCP server)                     │
│  ├── scope guard (CIDR/domain allow-list)                   │
│  ├── capability probe (detects installed tools at startup)  │
│  ├── exec wrapper → full output to loot, summary to AI      │
│  ├── session manager (listeners/captures keyed by ID)       │
│  └── tools / resources / prompts                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ spawns
┌──────────────────────▼──────────────────────────────────────┐
│  OS tool layer (nmap, hydra, sqlmap, nc, socat, ...)        │
│  └── whatever exists on the runtime box — probed, not assumed│
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions**

| Decision | Rationale |
|---|---|
| Node + TypeScript + `@modelcontextprotocol/sdk` | Matches `cline_mcp_settings.json` sketch; first-class MCP support |
| stdio transport | Local, on-box. No sockets exposed |
| Scope guard in code | SDK arg-validation + server-side CIDR/domain check. Authorization is enforced, not requested |
| Loot-file output pattern | Full tool output → file under `$COBRA_LOOT_DIR`; AI gets summary + path. Saves tokens, enables planning |
| Capability probing at startup | Runtime OS ≠ dev machine. Server reports what exists + what package provides what's missing |
| Session objects for long-running tools | `listen_start` returns an ID; server tracks PID + output-so-far. No blind blocking |
| Brain as structured markdown | AI-updatable, human-readable, persists across sessions |

---

## 2. Tool ↔ Package Manifest

The capability probe maps each MCP tool to the binary it needs and the package that provides it.

### 2a. Core (built first)

| MCP tool | Binary | Debian/Kali package | macOS (brew) |
|---|---|---|---|
| `recon_fast_scan` / `recon_full_scan` / `recon_service_scan` / `recon_vuln_scan` / `recon_udp_scan` | `nmap` | `nmap` | `nmap` |
| `recon_dns` | `dig` | `dnsutils` | `bind` |
| `recon_whois` | `whois` | `whois` | `whois` |
| `recon_smb_enum` | `nmap` (smb NSE) | `nmap` | `nmap` |
| `web_dir_brute` | `ffuf` (fallback `gobuster`) | `ffuf` / `gobuster` | `ffuf` / `gobuster` |
| `web_vuln_scan` | `nikto` | `nikto` | `nikto` |
| `web_sql_inject` | `sqlmap` | `sqlmap` | `sqlmap` |
| `creds_brute` | `hydra` | `hydra` | `hydra` |
| `creds_crack_john` | `john` | `john` | `john-jumbo` |
| `creds_crack_hashcat` | `hashcat` | `hashcat` | `hashcat` |
| `exploit_search` | `searchsploit` | `exploitdb` | `exploitdb` |
| `local_privesc` | `linpeas.sh` (fetched) | — | — |
| `payload_egg_build` | `mkegg.sh` (bundled script) | — | — |
| `exfil_upserv_start` | `python3` | `python3` | `python3` |
| `payload_serve` | `python3` | `python3` | `python3` |
| `capture_sniff_start/stop` | `tcpdump` | `tcpdump` | `tcpdump` |
| `capture_pcap_start/stop` | `tshark` | `tshark` | `wireshark` |
| `listen_start/stop` | `nc` | `netcat-openbsd` | `netcat` |
| `exec_ssh` / `ssh_key_setup` / `tunnel_socks_start` | `ssh` + `sshpass` | `openssh-client` + `sshpass` | `openssh` + `sshpass` |
| `via=` routing (recon/web/creds) | `proxychains4` | `proxychains4` | `proxychains-ng` |
| `c2_gs_secret` / `c2_gs_deploy` / `c2_gs_shell` / `c2_gs_socks_start` / `c2_gs_list` | `gs-netcat` | gsocket static build (cobrashell `bin gs-netcat`; COBRA infra .onion) | `gsocket` |
| `shell_run` / `shell_xhome_probe` | `bash` + cobrashell (only the xhome probe reads it) | `bash` | `bash` |

### 2b. Deferred to profiles

| Profile | Tools | Packages |
|---|---|---|
| `ad` | impacket-*, responder, netexec (nxc) | `impacket-scripts` `responder` `netexec` |
| `exploit` | msfconsole (RPC) | `metasploit-framework` |
| `webplus` | ffuf, wpscan, mitmproxy | `ffuf` `wpscan` `mitmproxy` |
| `wireless` | aircrack-ng suite | `aircrack-ng` |

---

## 3. Environment / Config

```json
"cobra": {
  "command": "node",
  "args": ["/path/to/CobraStrike/cobra-mcp/build/index.js"],
  "env": {
    "COBRA_ALLOW_INTERNET": "0",
    "COBRA_ALLOWED_SCOPE": "192.168.0.0/16,10.0.0.0/8,lab.example.com",
    "COBRA_LOOT_DIR": "/dev/shm/cobra-loot",
    "COBRA_BRAIN_PATH": "/path/to/CobraStrike/brain/BRAIN.md",
    "COBRA_TRADECRAFT_DIR": "/path/to/CobraStrike/tradecraft"
  }
}
```

| Env var | Default | Meaning |
|---|---|---|
| `COBRA_ALLOW_INTERNET` | `0` | `1` allows tools to reach beyond scope (e.g. fetch linpeas). Default deny |
| `COBRA_ENABLE_TUNNELS` | `0` | `1` enables SSH SOCKS tunnels + `via` proxy routing (the xint equivalent for a non-interactive server). Also gate 1 for the `c2_gs_*` relay-C2 tools. Default off |
| `COBRA_ENABLE_SHELL` | `0` | Gate for `shell_run` — deliberately its own knob: arbitrary local exec (`bash -c`) is a separate blast radius from tunnels. It runs NON-INTERACTIVE bash, so the operator's login-shell rc is NOT loaded; the `shell_xhome_probe` tool reports cobrashell xhome-bastion visibility from the server's env. Default off |
| `GS_HOST` / `GS_PORT` | *(unset = public GSRN)* | Self-hosted gsocket relay for the `c2_gs_*` tools (native gsocket env; the client forwards them only when set). Egress rule: a relay outside scope — including the public GSRN — additionally requires `COBRA_ALLOW_INTERNET=1`; an in-scope relay needs only `COBRA_ENABLE_TUNNELS=1` |
| `COBRA_ALLOWED_SCOPE` | *(empty = deny all)* | Comma-separated CIDRs and domains. Empty = all targets refused |
| `COBRA_LOOT_DIR` | `./loot` | Where all tool output lands |
| `COBRA_BRAIN_PATH` | `./brain/BRAIN.md` | Brain file location |
| `COBRA_TRADECRAFT_DIR` | `./tradecraft` | Tradecraft guides location |
| `COBRA_REPO_ROOT` | *(repo root)* | Root for `scripts/` + `BUILD_PLAN.md` lookups. Set to `/etc/cobra` on baked COBRA OS images, or to `~/.cobra` by the generic `install.sh` launcher (the bundle's derived default would be `/` / `$HOME`). The client forwards it to the server (the MCP SDK spawns with a whitelisted env — nothing crosses unless the client passes it). |

---

## 4. MCP Surface

### Tools
- **Session/context:** `target_set`, `target_get`, `loot_path`
- **Recon:** `recon_fast_scan`, `recon_full_scan`, `recon_service_scan`, `recon_vuln_scan`, `recon_udp_scan`, `recon_dns`, `recon_whois`, `recon_smb_enum`
- **Web:** `web_dir_brute`, `web_vuln_scan`, `web_sql_inject`
- **Credentials:** `creds_brute`, `creds_crack_john`, `creds_crack_hashcat`
- **Exploit/privesc (offline-safe):** `exploit_search`, `local_privesc`
- **Payload/exfil:** `payload_egg_build`, `exfil_upserv_start`, `payload_serve`
- **Capture/listen (session-managed):** `capture_sniff_start/stop`, `capture_pcap_start/stop`, `listen_start/stop`, `session_list`, `session_output`, `session_kill`
- **Lateral movement:** `exec_ssh` (scope-gated remote exec, password or key), `ssh_key_setup` (engagement keypair in the loot dir), `tunnel_socks_start/stop/list` (ssh -D SOCKS5 sessions; gated on `COBRA_ENABLE_TUNNELS`), plus `via=` routing on recon/web/creds tools (proxychains4 per generated conf)
- **Relay C2 (gs-netcat):** `c2_gs_secret` (secret gen), `c2_gs_deploy` (beacon one-liner + optional SSH auto-deploy: arch check, base64 upload to target `/dev/shm`, daemonized launch, pgrep verify), `c2_gs_shell` (non-interactive command through the relay), `c2_gs_socks_start` (SOCKS5 pivot — registers as a tunnel, so `via=` routing works), `c2_gs_list` (beacon/tunnel dashboard + cleanup commands). Double-gated: `COBRA_ENABLE_TUNNELS=1` + egress rule (relay outside scope ⇒ `COBRA_ALLOW_INTERNET=1`). Secrets ride `-k` keyfiles (0600, loot `keys/`) / `GSOCKET_ARGS` — never argv or logs
- **Brain (write side):** `brain_write` (full-document replace — the doctrine's "update the brain every phase" is impossible without it), `brain_append` (dated note; Lessons Learned)
- **Local shell (operator box):** `shell_run` (arbitrary `bash -c`, sentinel exit-code parsing, full output → loot; gated by `COBRA_ENABLE_SHELL=1` — its own knob; optional `target=` scope-checks an IP/host literal appearing in the args) and `shell_xhome_probe` (ungated, read-only: reports cobrashell xhome-bastion visibility from the server env + the exact PATH/mark-running plumbing to use it as a bastion cwd)

### Resources
- `cobra://opshelp` — tool usage registry (self-discovery)
- `cobra://capabilities` — probed tool availability + install hints
- `cobra://target` — active target
- `cobra://loot/{path}` — loot file tree
- `cobra://sessions` — active capture/listen sessions
- `cobra://brain` — current brain state
- `cobra://missions` — missions dir (absolute), template path, exact run command, mission list
- `cobra://missions/{file}` — read one mission file
- `cobra://tradecraft/{guide}` — tradecraft guides
- `cobra://buildplan` — this file

### Prompts
- `recon-triage` — fscan → portscan → svcscan progression
- `web-assessment` — webdir → webvuln → sql sequencing
- `credential-attack` — scope reminder → hydra/john/hashcat
- `authorized-engagement` — consent/contract framing + scope-confirmed gating

---

## 5. The Brain (`brain/BRAIN.md`)

Structured, append-friendly, AI-updated after every phase:

- **Mission** — objective from mission file
- **Target Profile** — OS guesses, hostname, network position
- **Attack Surface Map** — ports/services/versions (pointers to loot, not raw dumps)
- **Credentials** — found/cracked creds + validity
- **Access** — footholds, shell type, privesc state
- **Attempted & Failed** — dead ends (never retry)
- **Hypotheses / Next Moves** — ranked plan
- **Lessons Learned** — cross-mission wisdom

Playbooks in `brain/playbooks/` encode pre-canned flows so common engagements run on rails.

---

## 6. Tradecraft Guides (`tradecraft/`)

Hack-tricks knowledge distilled into task-oriented guides. Format per technique:
**When to use → Requirements → Command → Expected output → OPSEC notes → Fallbacks.**

| Guide | Covers |
|---|---|
| `01-recon.md` | host discovery, port scanning, service enum, password grep |
| `02-shells.md` | reverse/dumb shells, PTY upgrades, socat |
| `03-tunneling.md` | SSH tunnels, gost/websocat/cloudflared, iptables bounce, ghost IP |
| `04-persistence.md` | sshd backdoor, DNS implants, mkegg self-extractors |
| `05-stealth.md` | hackshell, zapper, hide PID/conn, shred, /dev/shm, memexec fileless |
| `06-exfil.md` | encodings, tmux/screen transfer, rsync, WebDAV, Telegram |
| `07-creds.md` | brute force (hydra/ncrack/nmap), hashcat, wordlists |
| `08-sniffing.md` | strace tit, eBPF ptysnoop, reptyr session hijack |
| `09-crypto.md` | password gen, LUKS/EncFS, openssl file encryption |
| `10-privesc.md` | SUID, writable dirs, local root backdoors |

`INDEX.md` = decision tree routing symptoms → guide sections.

---

## 7. Build Order

1. ✅ Scaffold + BUILD_PLAN.md + README.md
2. ✅ tradecraft/ guides (10 guides + decision-tree INDEX)
3. ✅ brain/ (BRAIN.md, mission template, 4 playbooks)
4. ✅ cobra-mcp core (config, scope, exec, capabilities, session tools)
5. ✅ recon + web + creds tools
6. ✅ payload/exfil/capture tools + resources + prompts
7. ✅ scripts/ standard flows (mkegg, recon-flow, web-flow)
8. ✅ build, smoke-test, config snippet — `tsc` clean, MCP handshake verified, `cline_mcp_settings.snippet.json` written

---

## 8. Roadmap

Phase status as of 2026-08-26: Phases 1–3 are in the tree. The gate/scope
regression harness is `scripts/smoke-mcp.sh` — **run it after any change to
gates, scope, or tool registration.**

- **Phase 1 — core ✅** — cobra-mcp (config, scope guard, exec wrapper, capability probe, session manager) + recon/web/creds/exploit/payload/capture/session/brain tools, resources, prompts, cobra-client.
- **Phase 2 — SSH lateral movement ✅** — `tools/lateral.ts`: `exec_ssh`, `ssh_key_setup`, `tunnel_socks_start/stop/list`, plus `via=` proxychains routing on recon/web/creds; lateral-movement playbook.
- **Phase 3 — gs-netcat C2/SOCKS ✅** — `tools/c2.ts`: `c2_gs_secret` / `c2_gs_deploy` / `c2_gs_shell` / `c2_gs_socks_start` / `c2_gs_list`; beacon registry in `state.ts`; egress rule (relay outside scope ⇒ `COBRA_ALLOW_INTERNET=1`); `GS_HOST`/`GS_PORT` client forwarding; c2-gsocket playbook; root BUILD_PLAN gs-netcat row.
- **Phase 4 — local shell ✅** — `tools/shell.ts`: `shell_run` (`bash -c`, sentinel exit-code parsing, full output → loot; own gate `COBRA_ENABLE_SHELL`, default off) + `shell_xhome_probe` (ungated env report for cobrashell xhome-bastion plumbing). Optional `target=` reuses `assertInScope`. Client/server launcher plumbing (`cobra-client/src/config.ts`, `/usr/local/bin/cobra` in the OS `chroot-setup.sh`) forwards the new knob. Harness: scenarios F–J, EXPECTED_TOOLS=45.
- **Phase 5 — `.onion` / Tor access** — `COBRA_PROXY` plumbing in the exec layer; `gs-netcat -T` hooks (already flagged in the c2-gsocket playbook). Proxy stays an independent gate axis from `COBRA_ALLOW_INTERNET`.
- **Phase 6 — profile wrappers** — OS `COBRA_PROFILES` cases surfaced as MCP tools; new categories land as `chroot-setup.sh` profile cases, never in the core package list.
- **Phase 7 — multi-target state + egress gates** — `state.ts` refactor for concurrent targets; extend the Phase-3 egress rule to `recon_vuln_scan` / `recon_whois` (whois is inherently internet-touching and currently ungated).

