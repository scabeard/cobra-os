# Playbook — Recon Triage

Progressive scan depth. Cheap → expensive. Stop when you have enough to plan.

## Flow
1. **Confirm scope** — target ∈ `COBRA_ALLOWED_SCOPE`. Refuse otherwise.
2. **Fast scan** — `recon_fast_scan` (nmap -T4 -F). Top ports, quick win.
3. **Full scan** — `recon_full_scan` (-p-) if fast scan shows few ports or mission needs completeness.
4. **Service scan** — `recon_service_scan` (-sV -sC) against discovered ports.
5. **Targeted enum** — SMB → `recon_smb_enum`; DNS → `recon_dns`; web → `web-assessment` playbook.
6. **Vuln scan** — `recon_vuln_scan` only if mission allows noise. Flag it as slow/loud.

## Decision points
- Web ports (80/443/8080/...) → switch to `web-assessment`
- 445/139 open → `recon_smb_enum`, consider `ad` profile
- 22 open + creds found → try SSH (see tradecraft/03)
- Few ports, filtered → UDP scan (`recon_udp_scan`, needs sudo)

## Output discipline
- Every scan → loot file. Read the **summary**, pull detail only as needed.
- Update brain `Attack Surface Map` after each scan.
- Record dead ends in `Attempted & Failed`.
