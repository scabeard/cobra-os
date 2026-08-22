# Playbook — Web Assessment

Sequence: enumerate → scan → inject. Escalate only on evidence.

## Flow
1. **Fingerprint** — note server, framework, CMS from headers/banners (from recon loot).
2. **Directory brute** — `web_dir_brute` with a sensible wordlist. Find hidden paths, admin panels, uploads.
3. **Vuln scan** — `web_vuln_scan` (nikto). Noisy; confirm mission allows.
4. **Manual probing** — forms, params, file upload, LFI/RFI, known CMS exploits.
5. **SQL injection** — `web_sql_inject` (sqlmap --batch) on injectable params.
6. **Exploit lookup** — `exploit_search` for identified software versions.

## Decision points
- Login page → try default creds, then `credential-attack` playbook
- Upload form → test for webshell upload (see tradecraft/04 §php-backdoor)
- CMS identified → version-specific exploit via `exploit_search`
- Injectable param → sqlmap → dump creds → `07-creds` for cracking

## Output discipline
- All tool output → loot files. Record endpoints + findings in brain.
- Note WAF/IDS behavior; throttle if blocked.
