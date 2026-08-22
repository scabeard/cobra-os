#!/usr/bin/env bash
#
# sync-cobra.sh — mirror the CobraStrike client into the website for curl-access.
#
# cobra-os.com/cobra/ serves the self-contained CobraStrike installer and the
# single-file agent bundle, so the AI operator loads on any box:
#   curl -fsSL https://cobra-os.com/cobra/install.sh | bash
# CobraStrike/cobra-client/ is the source of truth; website/cobra/ is the
# deployed mirror. Run this after editing the client or its installer —
# release.sh calls it automatically, and the files are committed with the site.
#
# Mirrored: install.sh + the bundled dist/cobra.js (under latest/). The bundle
# is ~600 KB — comfortably under the Cloudflare Pages 25 MiB per-file cap, so
# it ships on BOTH the clearnet Pages site and the .onion mirror (unlike the
# ISO, which is onion-only).

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SITE_DIR/../CobraStrike/cobra-client" && pwd)"
MIRROR="$SITE_DIR/cobra"

INSTALLER_SRC="$CLIENT_DIR/install.sh"
BUNDLE_SRC="$CLIENT_DIR/dist/cobra.js"

changed=0

# --- installer ---------------------------------------------------------------
[[ -f "$INSTALLER_SRC" ]] || { echo "[!] missing source: $INSTALLER_SRC" >&2; exit 1; }
bash -n "$INSTALLER_SRC" || { echo "[!] bash -n failed: $INSTALLER_SRC" >&2; exit 1; }
mkdir -p "$MIRROR"
if ! cmp -s "$INSTALLER_SRC" "$MIRROR/install.sh"; then
    install -m 0644 "$INSTALLER_SRC" "$MIRROR/install.sh"
    echo "[*] synced install.sh"
    changed=1
fi

# --- bundle (latest/) --------------------------------------------------------
# The bundle is a build artifact: rebuild it if it's missing or older than the
# client's src/. Never publish a stale agent.
if [[ ! -f "$BUNDLE_SRC" ]] || [[ -n "$(find "$CLIENT_DIR/src" -newer "$BUNDLE_SRC" -print -quit 2>/dev/null)" ]]; then
    echo "[*] (re)building the cobra.js bundle..."
    ( cd "$CLIENT_DIR" && npm run --silent bundle )
fi
[[ -f "$BUNDLE_SRC" ]] || { echo "[!] bundle build produced no dist/cobra.js" >&2; exit 1; }

mkdir -p "$MIRROR/latest"
if ! cmp -s "$BUNDLE_SRC" "$MIRROR/latest/cobra.js"; then
    install -m 0644 "$BUNDLE_SRC" "$MIRROR/latest/cobra.js"
    echo "[*] synced latest/cobra.js"
    changed=1
fi

[[ $changed -eq 0 ]] && echo "[*] website/cobra/ already in sync"
echo "[+] mirror ready: install.sh + latest/cobra.js -> website/cobra/"
