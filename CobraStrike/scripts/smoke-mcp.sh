#!/usr/bin/env bash
# smoke-mcp.sh — stdio gate/scope regression harness for cobra-mcp.
#
# Exercises the Phase 2/3 gate surface over real MCP stdio (newline-delimited
# JSON-RPC) with ZERO network access — every scenario stops at a gate or at
# beacon resolution, so gs-netcat does NOT need to be installed and nothing
# leaves the box:
#
#   A  default deny (tunnels OFF, internet OFF)
#      → handshake, tool registry count, Phase 2/3 tools present
#      → c2_gs_secret works ungated (local RNG only)
#      → c2_gs_shell / c2_gs_socks_start refused: RELAY C2 DISABLED
#      → tunnels gate fires BEFORE beacon resolution
#      → c2_gs_deploy one-liner mode works ungated; relay check self-skips
#      → c2_gs_list dashboard works, shows gates OFF
#   B  tunnels ON, internet OFF, GS_HOST unset (public GSRN)
#      → EGRESS DENIED naming the public GSRN
#   C  tunnels ON, internet OFF, GS_HOST inside COBRA_ALLOWED_SCOPE
#      → both gates pass; fails gracefully at beacon resolution
#   D  tunnels ON, internet OFF, GS_HOST outside scope
#      → EGRESS DENIED (outside COBRA_ALLOWED_SCOPE)
#      → c2_gs_deploy to an out-of-scope host → SCOPE VIOLATION
#   E  tunnels ON, internet ON, public GSRN
#      → egress gate satisfied; fails at beacon resolution (no relay contact)
#
# Usage: scripts/smoke-mcp.sh [--verbose]
# Exit:  0 all pass · 1 failures (work dir kept for debugging) · 2 setup error
#
# NOTE: EXPECTED_TOOLS pins the registry size (43 at Phase 3). Bump it when a
# phase adds or removes tools.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$HERE/../cobra-mcp/dist/cobra-mcp.js"
EXPECTED_TOOLS=43
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

command -v node >/dev/null 2>&1 || { echo "SETUP: node not on PATH" >&2; exit 2; }
[ -f "$DIST" ] || { echo "SETUP: $DIST missing — build it: (cd cobra-mcp && npm run bundle)" >&2; exit 2; }

WORK="$(mktemp -d /tmp/cobra-smoke.XXXXXX)"
KEEP_WORK=0
export COBRA_LOOT_DIR="$WORK/loot"
export COBRA_ALLOWED_SCOPE="10.13.37.0/24,lab.example"
IN_SCOPE_IP="10.13.37.1"
OOS_IP="192.0.2.1"   # TEST-NET-1: never in scope, never routed

SRV_PID=""
REQ=""
RES=""
ID=0
LAST=""
SCEN=0
PASS=0
FAILS=()

stop_server() {
  if [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" 2>/dev/null || true
    wait "$SRV_PID" 2>/dev/null || true
    SRV_PID=""
  fi
  if [ -n "$REQ" ]; then exec {REQ}>&- || true; REQ=""; fi
  if [ -n "$RES" ]; then exec {RES}<&- || true; RES=""; fi
}

# shellcheck disable=SC2317  # invoked indirectly via trap EXIT
cleanup() {
  stop_server
  [ "$KEEP_WORK" = "1" ] || rm -rf "$WORK"
}
trap cleanup EXIT

start_server() {  # args: extra env KEY=VAL... (scenario knobs)
  stop_server
  SCEN=$((SCEN + 1))
  mkfifo "$WORK/in" "$WORK/out"
  env -u GS_HOST -u GS_PORT -u COBRA_ENABLE_TUNNELS -u COBRA_ALLOW_INTERNET \
    COBRA_LOOT_DIR="$COBRA_LOOT_DIR" \
    COBRA_ALLOWED_SCOPE="$COBRA_ALLOWED_SCOPE" \
    "$@" node "$DIST" <"$WORK/in" >"$WORK/out" 2>"$WORK/server-$SCEN.log" &
  SRV_PID=$!
  exec {REQ}>"$WORK/in"
  exec {RES}<"$WORK/out"
  rm -f "$WORK/in" "$WORK/out"  # fds keep them alive; path must be free next scenario
}

rpc() {  # $1 method, $2 params JSON → LAST = matching response line
  ID=$((ID + 1))
  local method="$1" params="$2" line=""
  if ! printf '{"jsonrpc":"2.0","id":%d,"method":"%s","params":%s}\n' "$ID" "$method" "$params" 1>&$REQ 2>/dev/null; then
    LAST=""
    echo "  WARN: rpc $method — server stdin closed (server died?)" >&2
    return 1
  fi
  while IFS= read -r -t 20 line <&"$RES"; do
    [ "$VERBOSE" = "1" ] && printf '<<< %s\n' "$line" >&2
    case "$line" in
      *"\"id\":${ID},"* | *"\"id\":${ID}}"*) LAST="$line"; return 0 ;;
    esac
  done
  LAST=""
  echo "  WARN: rpc $method — timeout waiting for response id=$ID" >&2
  return 1
}

notify() { printf '%s\n' "$1" 1>&$REQ 2>/dev/null || true; }

handshake() {
  rpc "initialize" '{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cobra-smoke","version":"1.0"}}'
  notify '{"jsonrpc":"2.0","method":"notifications/initialized"}'
}

call_tool() {  # $1 tool name, $2 arguments JSON
  rpc "tools/call" "$(printf '{"name":"%s","arguments":%s}' "$1" "$2")"
}

check() {  # $1 label, $2 haystack, $3 required substring
  if [[ "$2" == *"$3"* ]]; then
    PASS=$((PASS + 1)); echo "  PASS  $1"
  else
    FAILS+=("$1")
    echo "  FAIL  $1 — expected: $3"
    if [ "$VERBOSE" = "1" ]; then echo "        in: ${2:-<empty response>}"; fi
  fi
}

check_absent() {  # $1 label, $2 haystack, $3 forbidden substring
  if [[ "$2" != *"$3"* ]]; then
    PASS=$((PASS + 1)); echo "  PASS  $1"
  else
    FAILS+=("$1")
    echo "  FAIL  $1 — unexpected: $3"
    if [ "$VERBOSE" = "1" ]; then echo "        in: ${2:-<empty response>}"; fi
  fi
}

tool_count() {
  printf '%s' "$LAST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.tools.length)}catch{console.log(-1)}})'
}

scenario() { echo; echo "== $1 =="; }

# --- A: default deny ----------------------------------------------------------
scenario "A: default deny (tunnels OFF, internet OFF)"
start_server
handshake || true
check "A1 handshake returns cobra-mcp" "$LAST" '"name":"cobra-mcp"'
rpc "tools/list" '{}' || true
LIST="$LAST"
N="$(tool_count)"
if [ "$N" = "$EXPECTED_TOOLS" ]; then
  PASS=$((PASS + 1)); echo "  PASS  A2 registry has $EXPECTED_TOOLS tools"
else
  FAILS+=("A2 registry count (got $N, want $EXPECTED_TOOLS)")
  echo "  FAIL  A2 registry has $EXPECTED_TOOLS tools — got $N (bump EXPECTED_TOOLS if a phase added tools)"
fi
check "A3 c2_gs_secret registered" "$LIST" '"name":"c2_gs_secret"'
check "A4 c2_gs_deploy registered" "$LIST" '"name":"c2_gs_deploy"'
check "A5 c2_gs_shell registered" "$LIST" '"name":"c2_gs_shell"'
check "A6 c2_gs_socks_start registered" "$LIST" '"name":"c2_gs_socks_start"'
check "A7 c2_gs_list registered" "$LIST" '"name":"c2_gs_list"'
check "A8 exec_ssh registered (phase 2)" "$LIST" '"name":"exec_ssh"'
check "A9 tunnel_socks_start registered (phase 2)" "$LIST" '"name":"tunnel_socks_start"'
call_tool "c2_gs_secret" '{}' || true
check "A10 secret gen works ungated (local RNG)" "$LAST" "gsocket secret"
call_tool "c2_gs_shell" '{"beacon":"n0-such","command":"id"}' || true
check "A11 shell refused when tunnels OFF" "$LAST" "RELAY C2 DISABLED"
check_absent "A12 tunnels gate fires before beacon resolution" "$LAST" "no such beacon"
call_tool "c2_gs_socks_start" '{"beacon":"n0-such"}' || true
check "A13 socks refused when tunnels OFF" "$LAST" "RELAY C2 DISABLED"
call_tool "c2_gs_deploy" '{}' || true
check "A14 deploy one-liner mode works ungated" "$LAST" "gs beacon ready"
check "A15 deploy relay check self-skips when gates off" "$LAST" "relay check: skipped"
call_tool "c2_gs_list" '{}' || true
check "A16 dashboard works ungated" "$LAST" "## Beacons"
check "A17 dashboard shows gates OFF" "$LAST" "tunnels=OFF"

# --- B: tunnels on, public GSRN, no internet ----------------------------------
scenario "B: tunnels ON, internet OFF, GS_HOST unset (public GSRN)"
start_server COBRA_ENABLE_TUNNELS=1
handshake || true
call_tool "c2_gs_shell" '{"beacon":"n0-such","command":"id"}' || true
check "B1 shell egress denied on public GSRN" "$LAST" "EGRESS DENIED"
check "B2 refusal names the public GSRN" "$LAST" "PUBLIC GSRN"
call_tool "c2_gs_socks_start" '{"beacon":"n0-such"}' || true
check "B3 socks egress denied on public GSRN" "$LAST" "EGRESS DENIED"

# --- C: in-scope self-hosted relay --------------------------------------------
scenario "C: tunnels ON, internet OFF, GS_HOST=$IN_SCOPE_IP (in scope)"
start_server COBRA_ENABLE_TUNNELS=1 GS_HOST="$IN_SCOPE_IP" GS_PORT=7350
handshake || true
call_tool "c2_gs_shell" '{"beacon":"n0-such","command":"id"}' || true
check_absent "C1 in-scope relay passes both gates" "$LAST" "EGRESS DENIED"
check "C2 fails at beacon resolution instead" "$LAST" "no such beacon"

# --- D: out-of-scope relay + out-of-scope deploy ------------------------------
scenario "D: tunnels ON, internet OFF, GS_HOST=$OOS_IP (out of scope)"
start_server COBRA_ENABLE_TUNNELS=1 GS_HOST="$OOS_IP"
handshake || true
call_tool "c2_gs_shell" '{"beacon":"n0-such","command":"id"}' || true
check "D1 out-of-scope relay egress denied" "$LAST" "EGRESS DENIED"
check "D2 refusal says outside COBRA_ALLOWED_SCOPE" "$LAST" "outside COBRA_ALLOWED_SCOPE"
call_tool "c2_gs_deploy" "{\"host\":\"$OOS_IP\",\"user\":\"op\"}" || true
check "D3 deploy to out-of-scope host refused" "$LAST" "SCOPE VIOLATION"

# --- E: internet on, public GSRN ----------------------------------------------
scenario "E: tunnels ON, internet ON, public GSRN"
start_server COBRA_ENABLE_TUNNELS=1 COBRA_ALLOW_INTERNET=1
handshake || true
call_tool "c2_gs_shell" '{"beacon":"n0-such","command":"id"}' || true
check_absent "E1 internet gate satisfies public-GSRN egress" "$LAST" "EGRESS DENIED"
check "E2 fails at beacon resolution (no relay contact attempted)" "$LAST" "no such beacon"

# --- summary --------------------------------------------------------------------
stop_server
echo
echo "=============================================="
echo "smoke-mcp: $PASS passed, ${#FAILS[@]} failed"
if [ "${#FAILS[@]}" -gt 0 ]; then
  printf '  FAILED: %s\n' "${FAILS[@]}"
  echo
  echo "work dir kept for debugging: $WORK"
  for f in "$WORK"/server-*.log; do
    if [ -s "$f" ]; then echo "--- $f (tail) ---"; tail -n 10 "$f"; fi
  done
  KEEP_WORK=1
  exit 1
fi
echo "all green — gate/scope surface intact."
exit 0
