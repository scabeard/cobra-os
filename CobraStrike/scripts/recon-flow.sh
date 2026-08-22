#!/bin/sh
# recon-flow.sh — standard recon sequence, all output to loot dir.
# Usage: COBRA_LOOT_DIR=/path recon-flow.sh <target>
set -e

T="$1"
[ -z "$T" ] && { echo "Usage: $0 <target>" >&2; exit 1; }
LOOT="${COBRA_LOOT_DIR:-./loot}"
mkdir -p "$LOOT"
TS=$(date +%s)

echo "[*] fast scan $T"
nmap -n -Pn -T4 -F --open "$T" >"$LOOT/recon-fast-$TS.log" 2>&1 || true

echo "[*] full scan $T"
nmap -n -Pn -p- --open -T4 "$T" >"$LOOT/recon-full-$TS.log" 2>&1 || true

PORTS=$(grep -oE '^[0-9]+/open' "$LOOT/recon-full-$TS.log" | cut -d/ -f1 | paste -sd, -)
if [ -n "$PORTS" ]; then
  echo "[*] service scan on $PORTS"
  nmap -n -Pn -sV -sC -p "$PORTS" "$T" >"$LOOT/recon-svc-$TS.log" 2>&1 || true
fi

echo "[*] done. loot in $LOOT (timestamp $TS)"
