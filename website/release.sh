#!/usr/bin/env bash
#
# release.sh — publish the COBRA OS site + mirrors, and (optionally) record a
# reference-build checksum for users to compare their own builds against.
#
# COBRA OS ships NO prebuilt ISO (build-your-own — see website/README.md). This
# script no longer stages or rewrites ISO references. It:
#   1. syncs the operator-shell mirror   (website/shell/  via sync-shell.sh)
#   2. syncs the CobraStrike client mirror (website/cobra/ via sync-cobra.sh)
#   3. optionally records a reference build's .sha256 into website/downloads/
#      so operators can verify a self-built image against ours
#   4. prints the onion-publish + deploy checklist
#
# Usage:
#   website/release.sh                            # sync mirrors + checklist
#   website/release.sh cobra-os-YYYYMMDD.iso      # also record that build's checksum

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONION_ADDR="afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion"   # replace with the live hidden-service address

# --- optional: record a reference build's checksum ----------------------------
iso="${1:-}"
if [[ -n "$iso" ]]; then
    [[ -f "$iso" ]] || { echo "[!] no such ISO: $iso" >&2; exit 1; }
    sum="$iso.sha256"
    [[ -f "$sum" ]] || { echo "[!] missing $sum — build-iso.sh writes it next to the ISO" >&2; exit 1; }
    echo "[*] verifying reference-build checksum..."
    ( cd "$(dirname "$iso")" && sha256sum -c "$(basename "$sum")" )
    echo "[*] recording $(basename "$sum") -> website/downloads/ (reference for self-builders)"
    cp "$sum" "$SITE_DIR/downloads/"
    echo "    note: the ISO itself is NOT hosted — only its checksum, for hash-compare."
fi

echo "[*] syncing the shell mirror (website/shell/)..."
"$SITE_DIR/sync-shell.sh"

echo "[*] syncing the CobraStrike mirror (website/cobra/)..."
"$SITE_DIR/sync-cobra.sh"

cat <<EOF

[+] staged. next:
  1. publish the site + mirrors to the .onion (home server):
       website/onion-sync.sh
     (rsyncs the site + downloads/ + bin/ to /srv/cobra-site/ over Tor/SSH — no ISO)
  2. sanity-check the onion:
       torsocks curl -fsSI "http://$ONION_ADDR/" | head -1
  3. publish the clearnet site — commit + push, Pages redeploys automatically:
       git add website && git commit -m "site update" && git push

  note: no prebuilt ISO is hosted anywhere. downloads/ carries only reference
  .sha256 files so operators can hash-compare their own build-iso.sh output.
EOF
