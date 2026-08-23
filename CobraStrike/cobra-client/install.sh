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
#   1. Ensures Node.js >= 18 is present — installs it if missing (apt first,
#      then a static tarball from nodejs.org into ~/.cobra/node).
#   2. Downloads the client bundle (cobra.js) AND the MCP server bundle
#      (cobra-mcp.js) to ~/.cobra/.
#   3. Drops a `cobra` launcher into ~/.local/bin and points the client at the
#      installed server via ~/.config/cobra/config.json.
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
SERVER_BUNDLE_NAME="cobra-mcp.js"
BUNDLE_URL="${COBRA_BASE_URL}/${COBRA_VERSION}/${BUNDLE_NAME}"
SERVER_BUNDLE_URL="${COBRA_BASE_URL}/${COBRA_VERSION}/${SERVER_BUNDLE_NAME}"
# Static Node fallback (used only if apt has no nodejs). LTS line.
NODE_DIST_VERSION="${COBRA_NODE_VERSION:-v20.18.1}"

# --- Pretty output -----------------------------------------------------------
say()  { printf '%s\n' "$*"; }
ok()   { printf '✔ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die()  { printf '✖ %s\n' "$*" >&2; exit 1; }

# --- 1. Node.js --------------------------------------------------------------
# COBRA OS ships no Node runtime (minimal image) — so the installer brings its
# own. Order: existing node >= 18 -> apt (Debian/Parrot) -> static tarball from
# nodejs.org into ~/.cobra/node. Only apt + nodejs.org are contacted; no
# telemetry, no phone-home. Honors a torify/torsocks wrapper if the operator
# pipes the whole installer through Tor.
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] 2>/dev/null
}

install_node_apt() {
  command -v apt-get >/dev/null 2>&1 || return 1
  local SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || return 1
    SUDO="sudo"
  fi
  say "Installing Node.js via apt…"
  $SUDO apt-get update -y >/dev/null 2>&1 || true
  $SUDO apt-get install -y --no-install-recommends nodejs >/dev/null 2>&1 || return 1
  node_ok
}

install_node_tarball() {
  local arch machine url tmp
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64)  arch="x64"   ;;
    aarch64|arm64) arch="arm64" ;;
    *) return 1 ;;
  esac
  url="https://nodejs.org/dist/${NODE_DIST_VERSION}/node-${NODE_DIST_VERSION}-linux-${arch}.tar.xz"
  say "Installing Node.js ${NODE_DIST_VERSION} (static tarball) into ${INSTALL_DIR}/node…"
  mkdir -p "$INSTALL_DIR"
  tmp="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp" || { rm -f "$tmp"; return 1; }
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$url" || { rm -f "$tmp"; return 1; }
  else
    rm -f "$tmp"; return 1
  fi
  rm -rf "${INSTALL_DIR}/node"
  mkdir -p "${INSTALL_DIR}/node"
  tar -xJf "$tmp" -C "${INSTALL_DIR}/node" --strip-components=1 || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  export PATH="${INSTALL_DIR}/node/bin:$PATH"
  node_ok
}

if node_ok; then
  ok "Node.js $(node --version) found"
else
  warn "Node.js >= 18 not found — attempting to install it."
  if install_node_apt; then
    ok "Node.js $(node --version) installed via apt"
  elif install_node_tarball; then
    ok "Node.js $(node --version) installed to ${INSTALL_DIR}/node"
  else
    die "Could not install Node.js >= 18. Install it manually (apt install nodejs, or https://nodejs.org) and re-run."
  fi
fi
# Persist the tarball path for the launcher (no-op when node is on PATH already).
NODE_BIN="$(command -v node)"

# --- 2. Download the bundles (client + MCP server) ---------------------------
mkdir -p "$INSTALL_DIR"
fetch() { # fetch <url> <dest>
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1" || return 1
  else
    die "Need curl or wget to download the bundles."
  fi
}

TARGET="${INSTALL_DIR}/${BUNDLE_NAME}"
say "Fetching ${BUNDLE_URL} …"
fetch "$BUNDLE_URL" "$TARGET" || die "Client download failed."
chmod +x "$TARGET"
ok "Client bundle installed to $TARGET"

SERVER_TARGET="${INSTALL_DIR}/${SERVER_BUNDLE_NAME}"
say "Fetching ${SERVER_BUNDLE_URL} …"
fetch "$SERVER_BUNDLE_URL" "$SERVER_TARGET" || die "Server download failed."
chmod +x "$SERVER_TARGET"
ok "MCP server bundle installed to $SERVER_TARGET"

# Point the client at the installed server. The client defaults to a repo
# checkout (../cobra-mcp/build/index.js) that doesn't exist on an installed
# box, so override server.args via the file config (mode 0600).
CONFIG_DIR="$HOME/.config/cobra"
CONFIG_FILE="${CONFIG_DIR}/config.json"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_FILE" <<EOF
{
  "server": {
    "command": "${NODE_BIN}",
    "args": ["${SERVER_TARGET}"]
  }
}
EOF
chmod 600 "$CONFIG_FILE"
ok "Server path configured in $CONFIG_FILE"

# --- 3. Launcher -------------------------------------------------------------
LAUNCHER_DIR="$HOME/.local/bin"
if [ ! -d "$LAUNCHER_DIR" ]; then
  mkdir -p "$LAUNCHER_DIR"
fi
LAUNCHER="${LAUNCHER_DIR}/cobra"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# Resolve node: prefer PATH, fall back to the installer's static tarball.
if command -v node >/dev/null 2>&1; then
  exec node "$TARGET" "\$@"
elif [ -x "${INSTALL_DIR}/node/bin/node" ]; then
  exec "${INSTALL_DIR}/node/bin/node" "$TARGET" "\$@"
else
  echo "cobra: node not found (re-run install.sh)" >&2
  exit 1
fi
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
