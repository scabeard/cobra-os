#!/usr/bin/env bash
#
# onion-sync.sh — publish the site + the ISO + the gs-netcat binaries to the
# home server's Tor hidden service.
#
# The .onion serves the SAME tree Cloudflare Pages deploys, PLUS the heavy
# things the clearnet never carries: the ISO under downloads/ and the static
# gs-netcat builds under bin/. Everything crosses to the home server over
# SSH (optionally wrapped through Tor itself), so the box's IP never appears
# in any clearnet record.
#
# Usage:
#   website/onion-sync.sh                      # sync site + bin/ (no ISO)
#   website/onion-sync.sh cobra-os-YYYYMMDD.iso  # also stage + sync that ISO
#
# Configure the three vars below (or export them) for your home server.

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- configuration (override via env) ----------------------------------------
# SSH target for the home server. Onion services hide the server's IP, so the
# safest transport is SSH *through* Tor: set ONION_SSH to the server's own
# SSH-onion address and let torsocks carry it. A plain host works too if you
# already reach it over a private/VPN path.
ONION_SSH="${ONION_SSH:-cobra-site}"            # ssh host/alias (see ~/.ssh/config)
ONION_ROOT="${ONION_ROOT:-/srv/cobra-site}"     # docroot the hidden service serves
USE_TORSOCKS="${USE_TORSOCKS:-1}"               # 1 = wrap ssh/rsync in torsocks

iso="${1:-}"

# --- pick the transport ------------------------------------------------------
RSYNC_RSH="ssh"
if [[ "$USE_TORSOCKS" == "1" ]]; then
    command -v torsocks >/dev/null 2>&1 \
        || { echo "[!] USE_TORSOCKS=1 but torsocks not found" >&2; exit 1; }
    RSYNC_RSH="torsocks ssh"
fi

echo "[*] target: $ONION_SSH:$ONION_ROOT (torsocks=$USE_TORSOCKS)"

# --- 1. stage the ISO locally (optional arg) ---------------------------------
# The ISO never enters git; onion-sync copies it into website/downloads/ only
# long enough to rsync it up, then leaves it in place (gitignored) for the
# next sync. The .sha256 IS versioned — release.sh already staged it.
if [[ -n "$iso" ]]; then
    [[ -f "$iso" ]] || { echo "[!] no such ISO: $iso" >&2; exit 1; }
    base="$(basename "$iso")"
    echo "[*] staging $base into website/downloads/ for upload"
    cp -f "$iso" "$SITE_DIR/downloads/$base"
    [[ -f "$iso.sha256" ]] && cp -f "$iso.sha256" "$SITE_DIR/downloads/$base.sha256"
fi

# --- 2. sanity: never push a broken tree -------------------------------------
bash -n "$SITE_DIR/sync-shell.sh"
[[ -f "$SITE_DIR/index.html" ]] || { echo "[!] no index.html in $SITE_DIR" >&2; exit 1; }

# --- 3. push the tree --------------------------------------------------------
# -a --delete keeps the onion a faithful mirror of the deployable site.
# Exclude VCS and any stray non-site files. downloads/*.iso rides along from
# the staging step above (it's gitignored locally but IS the point, here).
echo "[*] rsync site -> $ONION_ROOT"
rsync -a --delete -e "$RSYNC_RSH" \
    --exclude '.git/' \
    --exclude '.gitignore' \
    "$SITE_DIR/" "$ONION_SSH:$ONION_ROOT/"

echo "[+] onion mirror updated."
echo "    site:      http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/"
echo "    iso:       http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/downloads/<iso>"
echo "    binaries:  http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/bin/gs-netcat_*"
echo
echo "    verify:    torsocks curl -fsSI http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/ | head -1"
