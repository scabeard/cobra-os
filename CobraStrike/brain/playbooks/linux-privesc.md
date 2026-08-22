# Playbook — Linux Privilege Escalation

From foothold → root. Enumerate before exploiting.

## Flow
1. **Quick wins** — `sudo -l`, SUID (`10-privesc` §suid), writable dirs (§writable-dirs), cron, kernel version.
2. **Full sweep** — `local_privesc` (linpeas), tee output to loot. Read the summary.
3. **Credential hunt** — `01-recon` §password-grep, history files, config files, keys.
4. **Targeted exploit** — match kernel/sudo/service versions via `exploit_search`.
5. **Persist (if mission allows)** — `04-persistence` §local-root / §sshd-backdoor. Document for cleanup.

## Decision points
- SUID binary on GTFOBins → direct privesc
- Writable cron/script run as root → inject command
- Old kernel → dirty-pipe/dirtycow class exploit
- Docker group / lxd → container escape
- Found creds → `sudo` or `su`

## Output discipline
- linpeas output is huge — always to loot, read summary only.
- Record the working privesc path in brain `Access`.
