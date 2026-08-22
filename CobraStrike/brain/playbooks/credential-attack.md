# Playbook — Credential Attack

Scope-check first. Brute force is loud — prefer targeted over spray.

## Flow
1. **Scope reminder** — confirm target ∈ `COBRA_ALLOWED_SCOPE`.
2. **Choose wordlists** — see tradecraft/07 §wordlists. Small targeted list first.
3. **Online brute** — `creds_brute` (hydra) with `-t4` throttle, `-f` stop-on-first-hit.
4. **Offline crack** — got hashes? `creds_crack_john` (CPU) or `creds_crack_hashcat` (GPU).
5. **Validate** — test every cracked cred against every service. Record in brain `Credentials`.

## Decision points
- Lockout policy suspected → slow down, spray single password across users instead
- NTLM hash → try pass-the-hash before cracking
- known_hosts hashes → tradecraft/07 §known-hosts to reveal pivot IPs
- Default-cred service → try defaults before any wordlist

## Output discipline
- Log every attempt in brain `Attempted & Failed` (with lockout notes).
- Record valid creds immediately in brain `Credentials`.
