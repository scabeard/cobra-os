a pentesting AI assistant
has full rule of the lab and built to test against vuln machines in full automation and self preservation along with hiding capabilities
reads from mission plan and executes 
is a master a windows - linux and MAC along with networking and routers
has a brain file that updates
will be part of cobra os eventualy and loads from cobra shell in the future
uses custom mcp server
uses tool flow with pre customized pentesting flows to save time
over all red team flow is read mission plan file
set target and standard scripts all output to files the AI then reads and can us to come up with plans for root flag or whatever the mission plan is
uses operrouter api key with KAT coder 2 or whatever works well 

we will build off of this for mcp server 

Here's the proposed MCP server spec for the future self-automated red team tester — structured so we can build on it incrementally. It's framed around COBRA's authorized-use philosophy and hardening defaults.

# cobra-mcp — MCP server spec v0.1

## Design constraints (from COBRA rules)
- **Non-interactive**: MCP tools can't prompt. So `egg`/`upserv` wizards → non-interactive passthrough only; `xint` is flipped by env/config at server start, and every internet-touching tool is **allow-listed in config** rather than self-gated.
- **Scope guard baked in**: SDK arg-validation + a server-side `ALLOWED_SCOPE` (CIDRs/domains) list — tools refuse targets outside scope (authorization framing at the code level).
- **Transport**: stdio (local, on-box). No sockets exposed. Loot lands under a designated `COBRA_LOOT_DIR`.

---

## Tools (the executable surface)

### Session / context
| name | wraps | notes |
|---|---|---|
| `target_set` | `target <host>` | persists per-server state |
| `target_get` | `target` | returns active target |
| `loot_path` | — | returns/sets `$COBRA_LOOT_DIR` |

### Recon
| name | wraps |
|---|---|
| `recon_fast_scan` | `fscan` (nmap -T4 -F) |
| `recon_full_scan` | `portscan` (-p-) |
| `recon_service_scan` | `svcscan` (-sV -sC) |
| `recon_vuln_scan` | `vulnscan` — flagged slow/noisy in description |
| `recon_udp_scan` | `udpscan` (sudo) |
| `recon_dns` | `dnsq` |
| `recon_whois` | `whois` |
| `recon_smb_enum` | `smbenum` |

### Web
| name | wraps |
|---|---|
| `web_dir_brute` | `webdir <url> [wordlist]` |
| `web_vuln_scan` | `webvuln` (nikto) |
| `web_sql_inject` | `sql` (sqlmap --batch) |

### Credentials
| name | wraps |
|---|---|
| `creds_brute` | `brute <host> <svc> <user>` (session-managed — poll `session_output`) |
| `creds_crack_john` | `crack <hashfile>` |
| `creds_crack_hashcat` | `hashcrack <mode> <hashfile>` |

### Exploit lookup / local privesc (offline — always safe)
| name | wraps |
|---|---|
| `exploit_search` | `sploit <terms>` |
| `local_privesc` | `privesc` (linpeas, local only — long output, advise `tee` to loot) |

### Payload & exfil
| name | wraps |
|---|---|
| `payload_egg_build` | `egg <out> <files..> <cmd>` (non-interactive passthrough) |
| `exfil_upserv_start` | `upserv <bind> <port> <dir>` |
| `payload_serve` | `serve [port]` (spawns http.server for egg delivery) |

### Capture / listeners (session-managed)
| name | wraps |
|---|---|
| `capture_sniff_start/stop` | `sniff` (tcpdump) |
| `capture_pcap_start/stop` | `pcap` (tshark) |
| `listen_start/stop` | `listen` (nc -lvnp) |

*Long-running tools are session objects keyed by ID — the MCP server tracks PIDs and returns output-so-far, instead of blind blocking on a reverse shell that never comes.*

**Deferred to profiles** (match BUILD_PLAN §2a): `ad` (impacket/responder/netexec), `exploit` (msfconsole RPC?), `webplus` (ffuf/wpscan/mitmproxy), `wireless`. Start with core.

---

## Resources (read-side)
- `cobra://opshelp` — the opshelp registry text (lets the AI self-discover command usage)
- `cobra://target` — active target
- `cobra://loot/{path}` — loot files tree
- `cobra://sessions` — active capture/listen sessions
- `cobra://buildplan` — BUILD_PLAN.md sync table (tool ↔ package mapping)

---

## Prompts (workflow scaffolding)
- `recon-triage` — pick scan depth from fscan→portscan→svcscan progression
- `web-assessment` — webdir → webvuln → sql sequencing
- `credential-attack` — scope check reminder → hydra/john/hashcat
- `authorized-engagement` — system prompt fragment: consent/contract framing + scope-confirmed tool gating

---

## Config (cline_mcp_settings.json)
```json
"cobra": {
  "command": "node",
  "args": ["/home/x/Documents/Cline/MCP/cobra-mcp/build/index.js"],
  "env": {
    "COBRA_ALLOW_INTERNET": "0",
    "COBRA_ALLOWED_SCOPE": "192.168.0.0/16,lab.example.com",
    "COBRA_LOOT_DIR": "/dev/shm/cobra-loot"
  }
}
```

---

we will add thethe skills we find in hacktricks folder to our skill set if it helps us 
as we want to create an inovative red team pentesting model 
we understand that most pentesting and capture the flag engagments follow a logical path we want our AI to use scripts and or common tools we have or make 
to carry out the testswhen automation is needed and then read the output files when the scans are complete to save itself useage and be able to plan out its next move
it can make files and folders and has root access when needed and even makr its own code and tools if need to get crafty or feels like doing something a better or smarter way
we want an A+ so anything to make it better feel free to add as long it it stick to the "building a red team terminator" model haha

