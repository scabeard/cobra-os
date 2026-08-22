#!/usr/bin/env bash
#
# release.sh — stage a new COBRA OS ISO for cobra-os.com + the .onion mirror.
#
# Run from the repo root after build-iso.sh produces a new image:
#
#   website/release.sh cobra-os-YYYYMMDD.iso
#
# What it does:
#   1. verifies the image against its .sha256 (refuses to stage a bad build)
#   2. copies the .sha256 into website/downloads/ (versioned with the site)
#   3. rewrites every ISO filename / size reference in website/index.html
#   4. syncs the operator-shell mirror (website/shell/ via sync-shell.sh)
#   5. syncs the CobraStrike client mirror (website/cobra/ via sync-cobra.sh)
#   6. prints the onion-publish + deploy checklist
#
# The ISO itself NEVER enters git and NEVER touches Cloudflare Pages (25 MiB
# cap). It ships ONLY from the .onion service on the home server — publish it
# with website/onion-sync.sh (see website/README.md → "The Tor mirror").

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEX="$SITE_DIR/index.html"
ONION_ADDR="afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion"   # replace with the live hidden-service address

iso="${1:-}"
[[ -n "$iso" && -f "$iso" ]] || { echo "usage: $0 <cobra-os-YYYYMMDD.iso>" >&2; exit 1; }
sum="$iso.sha256"
[[ -f "$sum" ]] || { echo "[!] missing $sum — build-iso.sh writes it next to the ISO" >&2; exit 1; }

base="$(basename "$iso")"
[[ "$base" =~ ^cobra-os-[0-9]{8}\.iso$ ]] \
    || { echo "[!] unexpected name: $base (want cobra-os-YYYYMMDD.iso)" >&2; exit 1; }

echo "[*] verifying checksum..."
( cd "$(dirname "$iso")" && sha256sum -c "$(basename "$sum")" )

size_bytes="$(stat -c %s "$iso")"
size_gib="$(awk -v b="$size_bytes" 'BEGIN{ printf "%.1f", b/1073741824 }')"

echo "[*] staging $(basename "$sum") -> website/downloads/"
cp "$sum" "$SITE_DIR/downloads/"

echo "[*] updating index.html -> $base (${size_gib} GiB)"
sed -i -E \
    -e "s/cobra-os-[0-9]{8}\.iso/$base/g" \
    -e "s#<strong>[0-9.]+ (GiB|GB)</strong>#<strong>${size_gib} GiB</strong>#g" \
    -e "s#>[0-9.]+&nbsp;(GiB|GB)<#>${size_gib}\&nbsp;GiB<#g" \
    "$INDEX"

echo "[*] syncing the shell mirror (website/shell/)..."
"$SITE_DIR/sync-shell.sh"

echo "[*] syncing the CobraStrike mirror (website/cobra/)..."
"$SITE_DIR/sync-cobra.sh"

cat <<EOF

[+] staged. next:
  1. publish the build to the .onion (home server):
       website/onion-sync.sh "$iso"
     (rsyncs the site + downloads/ + bin/ to /srv/cobra-site/ over Tor/SSH)
  2. sanity-check the object on the onion:
       torsocks curl -fsSI "http://$ONION_ADDR/downloads/$base" | head -5
  3. publish the clearnet site — commit + push, Pages redeploys automatically:
       git add website && git commit -m "release $base" && git push

  note: the ISO is onion-only. The clearnet Pages deploy carries the site,
  the /shell/ + /cobra/ mirrors, and the .sha256 — never the image.
EOF
