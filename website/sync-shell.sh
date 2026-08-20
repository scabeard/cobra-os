#!/usr/bin/env bash
#
# sync-shell.sh — mirror the operator shell into the website for curl-access.
#
# cobra-os.com serves the same files the OS installs to /etc/cobra/ — so
#   source <(curl -fsSL https://cobra-os.com/shell/cobrashell.sh)
# loads the shell on any box when the OS isn't booted (HTB/VulnHub/a jumped
# host). shell/ (repo root) is the source of truth; website/shell/ is the
# deployed mirror. Run this after editing anything in shell/ — release.sh
# calls it automatically, and the files are committed with the site.
#
# Mirrored: cobrashell.sh + the vendored helpers its functions can use on a
# foreign box. cobra-ops.sh / cobra-theme.sh stay OS-only (they assume the
# COBRA toolset / a Linux TTY).

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SITE_DIR/../shell" && pwd)"
MIRROR="$SITE_DIR/shell"

FILES=(
    cobrashell.sh
    ghostip.sh
    whatserver.sh
    mkegg.sh
    linpeas.sh
    upload_server.php
)

mkdir -p "$MIRROR"

changed=0
for f in "${FILES[@]}"; do
    src="$SRC_DIR/$f"
    dst="$MIRROR/$f"
    [[ -f "$src" ]] || { echo "[!] missing source: $src" >&2; exit 1; }
    # never publish a broken bash script (php has no bash -n)
    if [[ "$f" == *.sh ]]; then
        bash -n "$src" || { echo "[!] bash -n failed: $src" >&2; exit 1; }
    fi
    if ! cmp -s "$src" "$dst"; then
        install -m 0644 "$src" "$dst"
        echo "[*] synced $f"
        changed=1
    fi
done

# prune anything in the mirror that no longer belongs
shopt -s nullglob
for dst in "$MIRROR"/*; do
    base="$(basename "$dst")"
    [[ " ${FILES[*]} " == *" $base "* ]] || { rm -f "$dst"; echo "[*] pruned $base"; changed=1; }
done

[[ $changed -eq 0 ]] && echo "[*] website/shell/ already in sync"
echo "[+] mirror ready: ${#FILES[@]} files -> website/shell/"
