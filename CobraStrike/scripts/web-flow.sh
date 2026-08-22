#!/bin/sh
# web-flow.sh — standard web assessment sequence, output to loot dir.
# Usage: COBRA_LOOT_DIR=/path web-flow.sh <url> [wordlist]
set -e

URL="$1"
WL="${2:-/usr/share/wordlists/dirb/common.txt}"
[ -z "$URL" ] && { echo "Usage: $0 <url> [wordlist]" >&2; exit 1; }
LOOT="${COBRA_LOOT_DIR:-./loot}"
mkdir -p "$LOOT"
TS=$(date +%s)

echo "[*] dir brute $URL"
if command -v ffuf >/dev/null 2>&1; then
  ffuf -u "${URL%/}/FUZZ" -w "$WL" -mc 200,204,301,302,307,401,403 >"$LOOT/web-dir-$TS.log" 2>&1 || true
elif command -v gobuster >/dev/null 2>&1; then
  gobuster dir -u "$URL" -w "$WL" -q >"$LOOT/web-dir-$TS.log" 2>&1 || true
fi

if command -v nikto >/dev/null 2>&1; then
  echo "[*] nikto $URL"
  nikto -h "$URL" >"$LOOT/web-nikto-$TS.log" 2>&1 || true
fi

echo "[*] done. loot in $LOOT (timestamp $TS)"
