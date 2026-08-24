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
# Mirrored: install.sh + the bundled dist/cobra.js AND dist/cobra-mcp.js (under
# latest/) + a doctrine tarball (brain + tradecraft + mkegg + BUILD_PLAN.md) that
# install.sh fetches into ~/.cobra/. The client bundle is ~600 KB, the server
# bundle similar, and the doctrine tree is a few dozen KB of Markdown —
# comfortably under the Cloudflare Pages 25 MiB per-file cap, so both ship on
# the clearnet Pages site AND the .onion mirror (unlike the ISO, onion-only).

set -euo pipefail

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SITE_DIR/../CobraStrike/cobra-client" && pwd)"
SERVER_DIR="$(cd "$SITE_DIR/../CobraStrike/cobra-mcp" && pwd)"
MIRROR="$SITE_DIR/cobra"

INSTALLER_SRC="$CLIENT_DIR/install.sh"
BUNDLE_SRC="$CLIENT_DIR/dist/cobra.js"
SERVER_BUNDLE_SRC="$SERVER_DIR/dist/cobra-mcp.js"

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

# --- server bundle (latest/cobra-mcp.js) -------------------------------------
# The client spawns this server over stdio; on an installed box there's no repo
# checkout, so the server must ship alongside the client. Rebuild when stale.
if [[ ! -f "$SERVER_BUNDLE_SRC" ]] || [[ -n "$(find "$SERVER_DIR/src" -newer "$SERVER_BUNDLE_SRC" -print -quit 2>/dev/null)" ]]; then
    echo "[*] (re)building the cobra-mcp.js bundle..."
    ( cd "$SERVER_DIR" && npm run --silent bundle )
fi
[[ -f "$SERVER_BUNDLE_SRC" ]] || { echo "[!] bundle build produced no dist/cobra-mcp.js" >&2; exit 1; }

if ! cmp -s "$SERVER_BUNDLE_SRC" "$MIRROR/latest/cobra-mcp.js"; then
    install -m 0644 "$SERVER_BUNDLE_SRC" "$MIRROR/latest/cobra-mcp.js"
    echo "[*] synced latest/cobra-mcp.js"
    changed=1
fi

# --- doctrine tree (latest/cobra-doctrine.tar.gz) -----------------------------
# install.sh extracts this into ~/.cobra/ so the installed MCP server resolves
# brain/tradecraft/missions/mkegg/build-plan (its repo-relative defaults derive
# to $HOME there). Repack whenever any source file is newer than the tarball —
# mtime-compare like the bundles above. Deterministic enough for a mirror:
# sorted file list, -C into the CobraStrike root so paths land at brain/… etc.
COBRA_ROOT="$(cd "$SITE_DIR/../CobraStrike" && pwd)"
DOCTRINE_OUT="$MIRROR/latest/cobra-doctrine.tar.gz"
DOCTRINE_SOURCES=(
    "$COBRA_ROOT/brain"
    "$COBRA_ROOT/tradecraft"
    "$COBRA_ROOT/scripts/mkegg.sh"
    "$COBRA_ROOT/BUILD_PLAN.md"
)
repack=0
if [[ ! -f "$DOCTRINE_OUT" ]]; then
    repack=1
else
    for s in "${DOCTRINE_SOURCES[@]}"; do
        if [[ -n "$(find "$s" -newer "$DOCTRINE_OUT" -print -quit 2>/dev/null)" ]]; then
            repack=1
            break
        fi
    done
fi
if [[ $repack -eq 1 ]]; then
    echo "[*] (re)packing the doctrine tree (brain + tradecraft + mkegg + BUILD_PLAN.md)..."
    tar -czf "$DOCTRINE_OUT" -C "$COBRA_ROOT" \
        brain \
        tradecraft \
        scripts/mkegg.sh \
        BUILD_PLAN.md
    echo "[*] packed latest/cobra-doctrine.tar.gz"
    changed=1
fi

[[ $changed -eq 0 ]] && echo "[*] website/cobra/ already in sync"
echo "[+] mirror ready: install.sh + latest/cobra.js + latest/cobra-mcp.js + latest/cobra-doctrine.tar.gz -> website/cobra/"
