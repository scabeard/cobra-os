#!/usr/bin/env bash
#
# chroot-setup.sh
# Runs INSIDE the debootstrapped chroot. Adds the Parrot repo, installs the
# curated COBRA tool set (console-only — NO X server, no GUI packages),
# installs cobrashell + cobra-ops, creates a non-root operator, and applies
# hardening (no root login, default-deny nftables, sysctl hardening,
# anti-forensics defaults, stripped docs).
#
# Staged by build-rootfs.sh at /root/cobra-stage/ together with:
#   cobrashell.sh    -> installed to /etc/cobra/cobrashell.sh
#   ghostip.sh       -> installed to /etc/cobra/ghostip.sh (sourced by ghostip())
#   whatserver.sh    -> installed to /etc/cobra/whatserver.sh (run by ws())
#   mkegg.sh         -> installed to /etc/cobra/mkegg.sh (run by the egg wizard)
#   upload_server.php -> installed to /etc/cobra/upload_server.php (run by upserv;
#                        needs php-cli from the webplus profile at runtime)
#   linpeas.sh       -> installed to /etc/cobra/linpeas.sh (run LOCALLY by
#                        cobra-ops privesc(); vendored PEASS-ng, no network)
#   cobra-ops.sh     -> installed to /etc/cobra/cobra-ops.sh (operator command registry)
#   cobra-theme.sh   -> installed to /etc/cobra/cobra-theme.sh (console theme)
#   splash.png       -> /boot/grub/splash.png + grub.d theme drop-in (rootfs
#                       builds only; the ISO gets its splash via includes.binary)
#

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

COBRA_HOSTNAME="${COBRA_HOSTNAME:-cobra}"
# Verified against https://deb.parrot.sh (2026-08): suite "parrot" is the
# rolling alias for the current release (codename "echo", Parrot 7, built on
# Debian trixie). The old "lory" suite (Parrot 6) is frozen — its indexes only
# carry parrot-core stubs, no tools. Re-verify before changing.
PARROT_SUITE="${PARROT_SUITE:-parrot}"
OPERATOR_USER="${OPERATOR_USER:-operator}"
# Optional extra tool profiles (space-separated): wireless ad exploit webplus
# e.g. COBRA_PROFILES="wireless exploit" — see BUILD_PLAN.md for what each adds.
COBRA_PROFILES="${COBRA_PROFILES:-}"

STAGE="/root/cobra-stage"

echo "[*] Setting hostname -> $COBRA_HOSTNAME"
echo "$COBRA_HOSTNAME" > /etc/hostname
# idempotent: resume runs (SKIP_DEBOOTSTRAP=1) must not stack duplicate lines
grep -qE "^127\.0\.1\.1[[:space:]]+$COBRA_HOSTNAME([[:space:]]|$)" /etc/hosts \
  || echo "127.0.1.1 $COBRA_HOSTNAME" >> /etc/hosts
# debootstrap minbase leaves /etc/hosts EMPTY — ensure localhost resolves.
# (The ISO has libnss-myhostname as a safety net; the rootfs build has nothing.)
grep -qE "^127\.0\.0\.1[[:space:]]+localhost([[:space:]]|$)" /etc/hosts \
  || echo "127.0.0.1 localhost" >> /etc/hosts
grep -qE "^::1[[:space:]]+localhost([[:space:]]|$)" /etc/hosts \
  || echo "::1 localhost ip6-localhost ip6-loopback" >> /etc/hosts

echo "[*] Installing prerequisites for repo signing..."
apt-get update
apt-get install -y --no-install-recommends wget gnupg ca-certificates apt-transport-https

echo "[*] Apt hygiene: never keep downloaded .debs (no dead weight in images)..."
# Applies to every apt run in this system — including live-build's binary
# stage, whose bootloader .debs would otherwise end up squashed into the ISO.
cat > /etc/apt/apt.conf.d/90cobra-no-cache << 'EOF'
// COBRA OS: delete .debs after install — no package cache leaking into
// the live squashfs, no cache accumulation on persistent installs.
APT::Keep-Downloaded-Packages "false";
EOF

echo "[*] Importing Parrot signing key..."
wget -qO- https://deb.parrot.sh/parrot/misc/parrotsec.gpg \
  | gpg --batch --yes --dearmor -o /usr/share/keyrings/parrot-archive-keyring.gpg

echo "[*] Adding Parrot repo (suite: $PARROT_SUITE)..."
cat > /etc/apt/sources.list.d/parrot.list << EOF
deb [signed-by=/usr/share/keyrings/parrot-archive-keyring.gpg] https://deb.parrot.sh/parrot ${PARROT_SUITE} main contrib non-free non-free-firmware
EOF

apt-get update

echo "[*] Installing base system (init, boot, network, shell essentials)..."
BASE_PKGS=(
    systemd systemd-sysv
    network-manager
    openssh-client
    sudo
    vim-tiny
    python3 python3-pip python3-venv
    curl
    iproute2
    nftables
    less
    tmux
    jq
    ripgrep
    ca-certificates
    # cobrashell support utilities: fuser (xtmux hidden-socket cleanup),
    # column/hexdump (whatserver COL, ssh-known-hosts2hashcat fallback).
    psmisc
    bsdextrautils
    # iputils-ping: the vendored ghostip.sh probes candidate ghost IPs with
    # ping (its ARP check is only the fallback); linpeas net discovery and
    # half of red-team muscle memory want it too.
    # strace: cobrashell tit() (TTY sniffing) hard-depends on it.
    iputils-ping
    strace
)
# NO GUI stack: COBRA OS is console-only by design. The X11/i3/Terminator +
# Firefox/Tor Browser layer (2026-08-15/16) is retired — nothing in the image
# needs startx, and nothing that needs startx may be added to these lists.
if [[ "${COBRA_ISO:-0}" == "1" ]]; then
    # live-build owns kernel + bootloader on the ISO (--linux-packages);
    # installing them here would only bloat the squashfs.
    echo "[*] COBRA_ISO=1 — skipping kernel/grub (live-build provides boot bits)"
else
    BASE_PKGS+=(linux-image-amd64 grub-pc)
fi
apt-get install -y --no-install-recommends "${BASE_PKGS[@]}"

echo "[*] Installing the curated COBRA core tool set (Parrot-fed, minimal)..."
# Every package here maps to a cobra-ops function and a row in BUILD_PLAN.md.
# Deliberately narrow — use COBRA_PROFILES or parrot-tools-* metapackages
# for broader coverage, at the cost of image size and surface area.
# NOTE: array form, not a backslash-continued apt-get — a '#' comment inside
# a continuation ends the command early (swallowed btop/nnn/links2/iptables
# once, breaking the build with "btop: command not found").
CORE_PKGS=(
    nmap
    hydra
    aircrack-ng
    john
    hashcat
    netcat-traditional
    tcpdump
    whois
    dnsutils
    sqlmap
    nikto
    gobuster
    tshark
    dirb
    wordlists
    tor
    torsocks
    proxychains4
    macchanger
    wireguard-tools
    # host enum + offline exploit lookup: enum4linux-ng is the SMB/Windows
    # null-session enumerator (cobra-ops smbenum); exploitdb ships
    # searchsploit + its local CSV (cobra-ops sploit) — fully offline.
    enum4linux-ng
    exploitdb
    # operator dashboard tools (the cobra-ops mon/files/web functions; tmux
    # itself is in BASE_PKGS — splits/tabs are the console dashboard).
    # links2 is also the Tor-capable web client: `xint && torify links2 <url>`.
    btop
    nnn
    links2
    # iptables (nft-translated on trixie): required by cobrashell ghostip /
    # ghostdev / bounce (SNAT/DNAT marks). Coexists with the nftables base.
    iptables
)
apt-get install -y --no-install-recommends "${CORE_PKGS[@]}"

echo "[*] Linking john into the operator PATH..."
# Debian's john package installs /usr/sbin/john, but login.defs ENV_PATH and
# /etc/profile give non-root users only /usr/local/bin:/usr/bin:/bin — without
# this, cobra-ops `crack` fails with "command not found" for the operator.
ln -sfn /usr/sbin/john /usr/local/bin/john

echo "[*] Preparing wordlists (rockyou.txt for hydra/john/hashcat)..."
if [ -f /usr/share/wordlists/rockyou.txt.gz ] && [ ! -f /usr/share/wordlists/rockyou.txt ]; then
    # no -k: keeping the .gz next to the 140 MB txt would double the
    # footprint (~60 MB of dead weight on a minimal image) — the
    # wordlists package can always restore it.
    gunzip /usr/share/wordlists/rockyou.txt.gz
fi

for profile in $COBRA_PROFILES; do
    case "$profile" in
        wireless)
            echo "[*] Profile: wireless (bettercap, hcxtools, reaver, kismet)..."
            apt-get install -y --no-install-recommends \
                bettercap hcxtools hcxdumptool reaver bully kismet
            ;;
        ad)
            echo "[*] Profile: active directory (impacket, responder, netexec, bloodhound)..."
            apt-get install -y --no-install-recommends \
                python3-impacket impacket-scripts responder netexec bloodhound.py
            ;;
        exploit)
            # exploitdb/searchsploit is CORE since 2026-08-17 — msf alone
            # stays profile-only (heavy; fine for engagements that need it).
            echo "[*] Profile: exploit (metasploit-framework)..."
            apt-get install -y --no-install-recommends \
                metasploit-framework
            ;;
        webplus)
            # mitmproxy replaces burpsuite: Burp is a Java GUI — dead weight
            # on a console-only image. mitmproxy is a full TTY proxy TUI.
            # php-cli: runtime for the vendored upload_server.php (cobra-ops
            # `upserv` loot-drop receiver) — CLI SAPI only, no Apache, no X.
            echo "[*] Profile: webplus (mitmproxy, ffuf, seclists, wpscan, php-cli)..."
            apt-get install -y --no-install-recommends \
                mitmproxy ffuf seclists wpscan php-cli
            ;;
        ai)
            # CobraStrike AI operator, baked in at build time (no runtime curl).
            # Managed node via apt; bundles are pre-built in CobraStrike/*/dist
            # and staged into the rootfs below (system-wide /etc/cobra, no
            # per-home files, no PATH hacks — launcher lands in /usr/local/bin).
            echo "[*] Profile: ai (CobraStrike operator — nodejs + vendored bundles)..."
            apt-get install -y --no-install-recommends nodejs
            ;;
        *)
            echo "[!] Unknown COBRA_PROFILES entry: $profile (skipping)"
            ;;
    esac
done

echo "[*] Installing cobrashell -> /etc/cobra/cobrashell.sh (+ vendored ghostip.sh/whatserver.sh)..."
install -d -m 0755 /etc/cobra
install -m 0644 "$STAGE/cobrashell.sh" /etc/cobra/cobrashell.sh
# vendored THC ghostip.sh — sourced locally by cobrashell's ghostip() (no
# remote sourcing, works without xint)
install -m 0644 "$STAGE/ghostip.sh" /etc/cobra/ghostip.sh
# vendored THC whatserver.sh — executed locally by cobrashell's ws() (no
# remote sourcing; its upstream ipinfo.io lookup is stripped — no network)
install -m 0644 "$STAGE/whatserver.sh" /etc/cobra/whatserver.sh
# vendored THC mkegg.sh — run locally by the cobra-ops egg() wizard (packs
# payloads into a self-extracting shell archive; tar/gzip only, no network)
install -m 0755 "$STAGE/mkegg.sh" /etc/cobra/mkegg.sh
# vendored THC upload_server.php — served by the cobra-ops upserv() wizard
# (loot-drop receiver; needs php-cli from the webplus profile at runtime)
install -m 0644 "$STAGE/upload_server.php" /etc/cobra/upload_server.php
# vendored PEASS-ng linpeas.sh — run LOCALLY by the cobra-ops privesc()
# enumerator (this box's own privesc paths; no network, no remote sourcing)
install -m 0755 "$STAGE/linpeas.sh" /etc/cobra/linpeas.sh

# --- CobraStrike AI operator (COBRA_PROFILES=ai) -----------------------------
# Deterministic, build-time install — no runtime curl. The bundles were staged
# by build-rootfs.sh only when the ai profile is active, so their presence is
# the switch. nodejs was apt-installed by the ai case above.
if [[ -f "$STAGE/cobra.js" && -f "$STAGE/cobra-mcp.js" ]]; then
    echo "[*] Installing CobraStrike AI operator (system-wide, /etc/cobra)..."
    install -m 0755 "$STAGE/cobra.js"     /etc/cobra/cobra.js
    install -m 0755 "$STAGE/cobra-mcp.js" /etc/cobra/cobra-mcp.js
    # ESM marker: bundles are esbuild format=esm; without this a .js file with
    # no package.json#type is parsed as CommonJS and dies on the import banner.
    printf '{ "type": "module" }\n' > /etc/cobra/package.json
    # System launcher on the standard PATH — no ~/.local/bin, no PATH edits.
    # The client only honors the server path via CLI flags or ~/.config/cobra/
    # config.json (it does NOT read a system config), so pass --server-command/
    # --server-args here. CLI flags always beat the client's repo-checkout
    # default. The operator's OpenRouter key still goes to the per-user
    # ~/.config/cobra/credentials (0600) via `cobra setup --save-key`.
    cat > /usr/local/bin/cobra << 'EOF'
#!/usr/bin/env bash
# COBRA OS system launcher for the CobraStrike AI operator (ai profile).
# Bundles + server live system-wide in /etc/cobra; the client is pointed at the
# server via CLI flags (its config-file default expects a repo checkout).
exec /usr/bin/node /etc/cobra/cobra.js \
    --server-command /usr/bin/node \
    --server-args /etc/cobra/cobra-mcp.js \
    "$@"
EOF
    chmod 0755 /usr/local/bin/cobra
fi

echo "[*] Hooking cobrashell + cobra-ops into interactive bash shells (HUSH=1 fast mode)..."
if ! grep -qF '# --- COBRA OS ---' /etc/bash.bashrc; then
cat >> /etc/bash.bashrc << 'EOF'

# --- COBRA OS ---
# Source the cobra operator shell for interactive bash sessions.
# HUSH=1 skips the loot sweep on login (run `loot` manually when wanted).
# Set COBRA_SHELL_OFF=1 in the environment to skip this entirely.
# Non-interactive shells (scp / `ssh host cmd`, if sshd is ever installed)
# must not load this — cobrashell's PTY upgrade would block on read and hang.
[[ $- == *i* ]] || return 0
if [ -z "$COBRA_SHELL_OFF" ] && [ -f /etc/cobra/cobrashell.sh ]; then
    HUSH=1
    source /etc/cobra/cobrashell.sh
fi
# Source the operator command registry (TUI port — every bash pane gets these).
if [ -z "$COBRA_SHELL_OFF" ] && [ -f /etc/cobra/cobra-ops.sh ]; then
    source /etc/cobra/cobra-ops.sh
fi
# Source the console theme (VGA palette, LS_COLORS, less/grep colors).
if [ -z "$COBRA_SHELL_OFF" ] && [ -f /etc/cobra/cobra-theme.sh ]; then
    source /etc/cobra/cobra-theme.sh
fi
EOF
fi
# Same upgrade-path hazard as cobra-ops below: pre-theme chroots carry the
# marker but no theme line. Ensure the theme is sourced regardless.
if ! grep -qF 'source /etc/cobra/cobra-theme.sh' /etc/bash.bashrc; then
cat >> /etc/bash.bashrc << 'EOF'

# --- COBRA OS (console theme) ---
if [ -z "$COBRA_SHELL_OFF" ] && [ -f /etc/cobra/cobra-theme.sh ]; then
    source /etc/cobra/cobra-theme.sh
fi
EOF
fi
# Upgrade path: chroots built before the 2026-08-15 Terminator refactor carry
# the SAME marker above but a cobrashell-only block, so the guard skips the
# append and cobra-ops never lands. Ensure the registry is sourced regardless.
if ! grep -qF 'source /etc/cobra/cobra-ops.sh' /etc/bash.bashrc; then
cat >> /etc/bash.bashrc << 'EOF'

# --- COBRA OS (ops registry) ---
if [ -z "$COBRA_SHELL_OFF" ] && [ -f /etc/cobra/cobra-ops.sh ]; then
    source /etc/cobra/cobra-ops.sh
fi
EOF
fi
# Retrofit (warm chroots): blocks written before 2026-08-17 lack the
# non-interactive guard above. Insert it after the marker line so reused
# chroots/ISO caches converge without a rebuild-from-scratch.
if grep -qF '# --- COBRA OS ---' /etc/bash.bashrc && ! grep -qF '[[ $- == *i* ]]' /etc/bash.bashrc; then
    sed -i '/^# --- COBRA OS ---$/a [[ $- == *i* ]] || return 0' /etc/bash.bashrc
fi

echo "[*] Installing COBRA operator command registry -> /etc/cobra/cobra-ops.sh ..."
# Ported from the retired Textual TUI (tui/cobra_tui.py). Every function maps
# 1:1 to an installed core package and a row in BUILD_PLAN.md §2. Sourced from
# /etc/bash.bashrc right after cobrashell so every bash pane gets these commands.
install -m 0644 "$STAGE/cobra-ops.sh" /etc/cobra/cobra-ops.sh

echo "[*] Installing COBRA console theme -> /etc/cobra/cobra-theme.sh ..."
# Red-team cyberpunk for the bare TTY: remaps the Linux console's 16-color
# VGA palette (so cobrashell's existing PS1/CR/CG/CC go neon), plus
# LS_COLORS / GREP_COLORS / LESS_TERMCAP_*. Pure escape sequences + env
# vars — no packages, no daemons, no X. COBRA_THEME_OFF=1 opts out.
install -m 0644 "$STAGE/cobra-theme.sh" /etc/cobra/cobra-theme.sh

echo "[*] Theme: building LS_COLORS database (/etc/cobra/ls_colors)..."
# Start from dircolors' full default db (keeps every extension mapping),
# then re-tint the key classes to the COBRA ramp: cyan dirs, violet links,
# neon-red executables/sockets, amber devices/fifos, bold-red archives.
dircolors -p | sed -E \
    -e 's/^DIR .*/DIR 01;36/' \
    -e 's/^LINK .*/LINK 01;35/' \
    -e 's/^MULTIHARDLINK .*/MULTIHARDLINK 00/' \
    -e 's/^FIFO .*/FIFO 01;33/' \
    -e 's/^SOCK .*/SOCK 01;31/' \
    -e 's/^DOOR .*/DOOR 01;31/' \
    -e 's/^BLK .*/BLK 01;33/' \
    -e 's/^CHR .*/CHR 01;33/' \
    -e 's/^ORPHAN .*/ORPHAN 01;37;41/' \
    -e 's/^EXEC .*/EXEC 01;31/' \
    -e 's/ 00;31([[:space:]]|$)/ 01;31\1/' \
    -e 's/ 00;36([[:space:]]|$)/ 01;36\1/' \
    > /tmp/cobra.dircolors
dircolors -b /tmp/cobra.dircolors > /etc/cobra/ls_colors
rm -f /tmp/cobra.dircolors

echo "[*] Theme: /etc/tmux.conf (cyberpunk status bar — tmux is the dashboard)..."
cat > /etc/tmux.conf << 'EOF'
# COBRA OS — console dashboard theme (red-team cyberpunk, no X).
# 256-color + truecolor passthrough (tmux-256color ships in ncurses-base).
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",*256col*:Tc"

# Status bar: near-black bar, neon-red COBRA tag, cyan clock.
set -g status on
set -g status-interval 5
set -g status-style "bg=#050508,fg=#d6dbe2"
set -g status-left "#[bg=#ff2a3c,fg=#050508,bold] COBRA #[bg=#050508,fg=#ff2a3c] #S "
set -g status-left-length 40
set -g status-right "#[fg=#3a3f4a]#(whoami)@#H #[fg=#2ee6e6]%H:%M "
set -g status-right-length 60

# Window tabs: gunmetal inactive, neon-red active.
setw -g window-status-style "bg=#050508,fg=#3a3f4a"
setw -g window-status-current-style "bg=#ff2a3c,fg=#050508,bold"
setw -g window-status-format " #I:#W "
setw -g window-status-current-format " #I:#W "

# Pane borders: gunmetal, neon-red when active.
set -g pane-border-style "fg=#3a3f4a"
set -g pane-active-border-style "fg=#ff2a3c"

# Messages + copy-mode selection: black on neon red.
set -g message-style "bg=#ff2a3c,fg=#050508,bold"
setw -g mode-style "bg=#ff2a3c,fg=#050508,bold"

setw -g clock-mode-colour "#2ee6e6"
EOF

echo "[*] Theme: /etc/issue login banner (pre-login console)..."
# agetty prints /etc/issue raw — real ESC bytes colorize the Linux console
# before login. \n \l \r \v are agetty's own escapes (hostname/tty/kernel).
{
    printf '\e[1;31m'
    cat << 'EOBANNER'
 ____ ___  ____  ____    _      ___  ____
/ ___/ _ \| __ )|  _ \  / \    / _ \/ ___|
| |  | | | |  _ \| |_) |/ _ \  | | | \___ \
| |__| |_| | |_) |  _ </ ___ \ | |_| |___) |
 \____\___/|____/|_| \_\/   \_\ \___/|____/
EOBANNER
    printf '\e[0;36mred team live OS :: authorized use only\e[0m\n'
    printf '\e[2m\\n \\l :: kernel \\r\e[0m\n'
} > /etc/issue

if [[ "${COBRA_ISO:-0}" != "1" ]]; then
    echo "[*] Theme: GRUB splash + colors (rootfs build)..."
    # The ISO path gets its splash/theme from live-build (includes.binary +
    # binary hook); here we theme grub-pc directly. The drop-in is picked up
    # whenever grub.cfg is (re)generated (update-grub / kernel postinst).
    install -m 0644 "$STAGE/splash.png" /boot/grub/splash.png
    install -d -m 0755 /etc/default/grub.d
    cat > /etc/default/grub.d/90-cobra-theme.cfg << 'EOF'
# COBRA OS — cyberpunk boot menu (gfxterm + PNG splash, no X needed).
GRUB_BACKGROUND="/boot/grub/splash.png"
GRUB_COLOR_NORMAL="light-cyan/black"
GRUB_COLOR_HIGHLIGHT="black/red"
GRUB_MENU_COLOR_NORMAL="light-cyan/black"
GRUB_MENU_COLOR_HIGHLIGHT="black/red"
EOF
fi

echo "[*] Purging retired artifacts (Textual TUI pre-2026-08-15, GUI/X11 post-2026-08-16)..."
# chroots reused across builds (SKIP_DEBOOTSTRAP=1, live-build cache) still
# carry retired files — chroot-setup only ever INSTALLS, never removes.
# Without this, stale TUI launchers shipped in the 2026-08-15 ISO; the same
# hazard applies to the X11/Terminator/browser layer retired by the
# console-only revert (2026-08-16).
rm -rf /opt/cobra-tui
rm -f /usr/local/bin/cobra-tui /usr/local/bin/cobra-console
rm -f /etc/cobra/tmux.conf
# Retired GUI layer: X session launcher, X wrapper config, Terminator/i3
# configs, Firefox enterprise policies.
rm -f /usr/local/bin/cobra-x
rm -f /etc/cobra/xinitrc /etc/X11/Xwrapper.config
rm -rf /etc/xdg/terminator /etc/i3
rm -rf /usr/lib/firefox-esr/distribution
# Purge the GUI packages themselves on warm chroots (no-op on fresh builds —
# nothing in BASE/CORE pulls X11 anymore). Keeps reused live-build chroots
# and SKIP_DEBOOTSTRAP rootfs' honest.
apt-get purge -y \
    xserver-xorg-core xserver-xorg-legacy xserver-xorg-video-fbdev \
    xserver-xorg-video-vesa xserver-xorg-input-libinput xserver-xorg \
    xinit xauth dbus-x11 x11-xserver-utils x11-common \
    i3 i3-wm terminator firefox-esr torbrowser-launcher 2>/dev/null || true
apt-get autoremove -y --purge 2>/dev/null || true

echo "[*] Creating non-root operator account..."

if ! id "$OPERATOR_USER" &>/dev/null; then
  # trixie's base-passwd ships a static 'operator' group (gid 37); when it
  # exists, useradd refuses to auto-create a per-user group — join it instead.
  if getent group "$OPERATOR_USER" >/dev/null; then
    useradd -m -s /bin/bash -g "$OPERATOR_USER" "$OPERATOR_USER"
  else
    useradd -m -s /bin/bash "$OPERATOR_USER"
  fi
  echo "${OPERATOR_USER}:changeme" | chpasswd
  usermod -aG sudo "$OPERATOR_USER"
  echo "[!] Scaffold password is 'changeme' — replaced on first login (see below)."
fi
# First-login password flow (2026-08-18): the old `chage -d 0` PAM-forced
# change made operators type 'changeme' TWICE in a row (login password, then
# pam's "current password" verification) — clunky and confusing on a console
# live OS. Replaced with: console autologin on tty1 (the live-distro norm —
# Debian/Kali/Parrot live all boot straight into the session) + a profile.d
# hook that forces `passwd` once, before the cobrashell loads, on EVERY
# login path until it succeeds. Un-expire accounts a previous build expired
# (warm chroots carry lastchg=0 forward).
chage -d "$(date +%F)" "$OPERATOR_USER" 2>/dev/null || true

echo "[*] Console: autologin $OPERATOR_USER on tty1 (live-image norm)..."
install -d -m 0755 /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
# COBRA OS — console autologin (live-image norm). The scaffold password is
# still replaced on first login via /etc/profile.d/00-cobra-firstlogin.sh;
# root stays locked, sudo still requires the operator password. Physical
# access = operator shell, same as any live distro — LUKS persistence
# (BUILD_PLAN.md §5) is the data-at-rest protection, not the console login.
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${OPERATOR_USER} --noclear %I \$TERM
EOF

echo "[*] First-login hook: forced one-time scaffold password replacement..."
cat > /etc/profile.d/00-cobra-firstlogin.sh << EOF
# COBRA OS — one-time scaffold-password replacement.
# Runs on every login-shell path (tty, ssh) before the first prompt.
# Note: Debian's /etc/profile sources bash.bashrc (cobrashell) BEFORE
# profile.d, so the banner prints first — the forced passwd still gates
# the session, and cobrashell's hs_exit trap absorbs the exit 1 below.
# Loops (exit 1 -> session drops -> autologin/getty retries) until passwd
# succeeds. A user-run passwd verifies the current password once — the
# single remaining 'changeme' prompt. No TTY -> skip (never wedge a
# non-interactive login; the next interactive one catches it).
if [ -t 0 ] && [ "\$(id -un 2>/dev/null)" = "${OPERATOR_USER}" ] && [ ! -e "\$HOME/.cobra-pw-done" ]; then
    echo ""
    echo "COBRA OS — replace the scaffold password 'changeme' now."
    echo "(current password, one last time: changeme)"
    if passwd; then
        touch "\$HOME/.cobra-pw-done" 2>/dev/null
        echo "[+] Operator password set. Stay frosty."
    else
        echo "[!] Password change is REQUIRED — dropping back to login."
        sleep 2
        exit 1
    fi
fi
EOF

echo "[*] Hardening: locking root account (sudo-only access)..."
passwd -l root

echo "[*] Hardening: default-deny nftables firewall..."
cat > /etc/nftables.conf << 'EOF'
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        iif lo accept
        ct state established,related accept
        ip protocol icmp accept
        # ICMPv6 carries NDP (neighbor solicitation/advertisement) — without
        # it IPv6 on the LAN silently dies against the default-deny policy.
        ip6 nexthdr icmpv6 accept
        # add explicit accept rules here for services you actually run
        # (e.g. `tcp dport 4444 accept` when expecting a reverse shell)
    }
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    chain output {
        type filter hook output priority 0; policy accept;
    }
}
EOF
systemctl enable nftables

echo "[*] Hardening: sysctl (kernel info leaks, network sanity)..."
# /etc/sysctl.d is shipped by the kernel image — which COBRA_ISO mode skips,
# and live-build installs its kernel only after hooks run. Create if absent.
install -d -m 0755 /etc/sysctl.d
cat > /etc/sysctl.d/90-cobra-hardening.conf << 'EOF'
# COBRA OS — kernel hardening
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.unprivileged_bpf_disabled = 1
kernel.kexec_load_disabled = 1
fs.suid_dumpable = 0
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2

# Network sanity (red team note: ip_forward stays 0 — `bounce` flips it at runtime)
net.ipv4.ip_forward = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
EOF

echo "[*] Hardening: disabling unused kernel modules at boot (USB storage off by default)..."
install -d -m 0755 /etc/modprobe.d   # owned by kmod — not guaranteed present
cat > /etc/modprobe.d/hardening.conf << 'EOF'
# Disable USB mass storage by default; re-enable manually if needed
install usb-storage /bin/false
# Disable uncommon/legacy network protocols
install dccp /bin/false
install sctp /bin/false
install rds /bin/false
install tipc /bin/false
# Disable uncommon/legacy filesystems
install cramfs /bin/false
install freevxfs /bin/false
install jffs2 /bin/false
install hfs /bin/false
install hfsplus /bin/false
install udf /bin/false
EOF

echo "[*] Anti-forensics: no shell/tool history for ANY user (live OS default)..."
cat > /etc/profile.d/00-cobra-nolog.sh << 'EOF'
# COBRA OS — amnesiac defaults. cobrashell sets these too; this covers
# non-bash and non-cobrashell contexts.
export HISTFILE=/dev/null
export BASH_HISTORY=/dev/null
export LESSHISTFILE=-
export MYSQL_HISTFILE=/dev/null
export PSQL_HISTORY=/dev/null
export SQLITE_HISTORY=/dev/null
export REDISCLI_HISTFILE=/dev/null
EOF

echo "[*] Anti-forensics: randomize Wi-Fi MAC per connection (NetworkManager)..."
cat > /etc/NetworkManager/conf.d/90-cobra-mac.conf << 'EOF'
[device]
wifi.scan-rand-mac-address=yes

[connection]
wifi.cloned-mac-address=random
ethernet.cloned-mac-address=stable
EOF

echo "[*] Stripping docs/man pages to save space..."
rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*

echo "[*] Cleaning apt cache..."
apt-get clean
if [[ "${COBRA_ISO:-0}" == "1" ]]; then
    # live-build's binary stage still apt-installs bootloader packages into
    # this chroot — leave the package indexes in place for it.
    echo "[*] COBRA_ISO=1 — keeping apt lists for live-build's binary stage"
else
    rm -rf /var/lib/apt/lists/*
fi

echo "[*] Linking /etc/mtab -> /proc/self/mounts (systemd standard; live tools expect it)..."
ln -sfn /proc/self/mounts /etc/mtab

echo "[*] chroot setup complete."
