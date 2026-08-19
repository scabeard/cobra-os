#!/usr/bin/env bash
#
# release.sh — stage a new COBRA OS ISO for cobra-os.com.
#
# Run from the repo root after build-iso.sh produces a new image:
#
#   website/release.sh cobra-os-YYYYMMDD.iso
#
# What it does:
#   1. verifies the image against its .sha256 (refuses to stage a bad build)
#   2. copies the .sha256 into website/downloads/ (versioned with the site)
#   3. rewrites every ISO filename / size reference in website/index.html
#   4. prints the upload + deploy checklist
#
# The ISO itself NEVER enters the repo or the Pages site — Cloudflare Pages
# caps files at 25 MiB. Builds ship to the R2 bucket behind dl.cobra-os.com
# (one-time setup: website/README.md).

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEX="$SITE_DIR/index.html"
DL_URL="https://dl.cobra-os.com"
R2_TARGET="r2:cobra-os-downloads"   # rclone remote:bucket — see website/README.md

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

cat <<EOF

[+] staged. next:
  1. upload the build to R2 (dl.cobra-os.com):
       rclone copyto "$iso" "$R2_TARGET/$base" --progress
       rclone copyto "$sum" "$R2_TARGET/$(basename "$sum")"
  2. sanity-check the object:
       curl -fsSI "$DL_URL/$base" | head -5
  3. publish the site — commit + push, Pages redeploys automatically:
       git add website && git commit -m "release $base" && git push
EOF
