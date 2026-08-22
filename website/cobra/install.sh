#!/usr/bin/env bash
#
# cobra — CobraStrike headless MCP client installer.
#
# Fetches the self-contained bundle from the project website and installs it
# locally. Run it again any time to update to the latest build.
#
# Usage:
#   curl -fsSL https://cobra-os.com/cobra/install.sh | bash
#   — or, for a specific version —
#   curl -fsSL https://cobra-os.com/cobra/install.sh | COBRA_VERSION=0.1.0 bash
#   — or, over Tor via the .onion mirror —
#   torsocks curl -fsSL http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/cobra/install.sh | bash
#
# What it does:
#   1. Verifies Node.js >= 18 is present.
#   2. Downloads dist/cobra.js (the single-file bundle) to ~/.cobra/.
#   3. Drops a `cobra` launcher into ~/.local/bin (or /usr/local/bin with sudo).
#   4. Verifies the install with `cobra doctor`.
#
# The OpenRouter API key is NOT handled here — run `cobra setup` after install.

set -euo pipefail

# --- Configuration -----------------------------------------------------------
# Served from the COBRA OS site (clearnet Pages + the .onion mirror). The
# bundle is fetched over HTTPS from cobra-os.com/cobra/ — or, on the onion,
# set COBRA_BASE_URL to the onion address and fetch over Tor.
COBRA_BASE_URL="${COBRA_BASE_URL:-https://cobra-os.com/cobra}"
COBRA_VERSION="${COBRA_VERSION:-latest}"
INSTALL_DIR="${COBRA_INSTALL_DIR:-$HOME/.cobra}"
BUNDLE_NAME="cobra.js"
BUNDLE_URL="${COBRA_BASE_URL}/${COBRA_VERSION}/${BUNDLE_NAME}"

# --- Pretty output -----------------------------------------------------------
say()  { printf '%s\n' "$*"; }
ok()   { printf '✔ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }

# --- 1. Node.js check --------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  die "Node.js is required (>= 18). Install it from https://nodejs.org and re-run."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js >= 18 required (found $(node --version))."
fi
ok "Node.js $(node --version) found"

# --- 2. Download the bundle --------------------------------------------------
mkdir -p "$INSTALL_DIR"
TARGET="${INSTALL_DIR}/${BUNDLE_NAME}"
say "Fetching ${BUNDLE_URL} …"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BUNDLE_URL" -o "$TARGET" || die "Download failed (curl)."
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TARGET" "$BUNDLE_URL" || die "Download failed (wget)."
else
  die "Need curl or wget to download the bundle."
fi
chmod +x "$TARGET"
ok "Bundle installed to $TARGET"

# --- 3. Launcher -------------------------------------------------------------
LAUNCHER_DIR="$HOME/.local/bin"
if [ ! -d "$LAUNCHER_DIR" ]; then
  mkdir -p "$LAUNCHER_DIR"
fi
LAUNCHER="${LAUNCHER_DIR}/cobra"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec node "$TARGET" "\$@"
EOF
chmod +x "$LAUNCHER"
ok "Launcher created at $LAUNCHER"

# PATH hint
case ":$PATH:" in
  *":$LAUNCHER_DIR:"*) : ;;
  *) warn "$LAUNCHER_DIR is not on your PATH. Add it, e.g.:  export PATH=\"$LAUNCHER_DIR:\$PATH\"" ;;
esac

# --- 4. Verify ---------------------------------------------------------------
say ""
say "Verifying install (cobra doctor)…"
if "$LAUNCHER" doctor; then
  ok "cobra is ready."
else
  warn "doctor reported issues — check your OpenRouter key and MCP server path."
fi

say ""
say "Next steps:"
say "  1. cobra setup --save-key     # store your OpenRouter key (0600)"
say "  2. cobra models               # pick a model"
say "  3. cobra run \"Recon triage the active target\""
