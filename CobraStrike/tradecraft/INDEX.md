# Tradecraft Index — Decision Tree

Route from **situation → guide section**. Each guide entry gives: when to use, requirements,
copy-paste command, expected output, OPSEC notes, fallbacks.

> ⚠️ Authorized use only. Confirm target is in `COBRA_ALLOWED_SCOPE` before any network action.

---

## I need to…

### Discover & map
- **Find live hosts on a LAN** → `01-recon.md` §host-discovery
- **Scan ports fast** → `01-recon.md` §port-scanning
- **Identify services/versions** → `01-recon.md` §service-enum
- **Profile a host I just landed on** → `01-recon.md` §host-profile
- **Find passwords/keys in files** → `01-recon.md` §password-grep

### Get & upgrade shells
- **Get a reverse shell (bash)** → `02-shells.md` §bash-reverse
- **Get a reverse shell (no /dev/tcp — embedded)** → `02-shells.md` §no-devtcp
- **Reverse shell through proxy/firewall (encrypted)** → `02-shells.md` §curlshell
- **Upgrade dumb shell → PTY** → `02-shells.md` §pty-upgrade
- **Upgrade → fully interactive (Ctrl-C works)** → `02-shells.md` §full-interactive
- **One-liner fully interactive via socat** → `02-shells.md` §socat-shell

### Move through networks
- **Tunnel through a pivot (SSH)** → `03-tunneling.md` §ssh-tunnels
- **SOCKS proxy into target network** → `03-tunneling.md` §socks
- **Get a public TCP port for a reverse shell** → `03-tunneling.md` §raw-tcp-reverse
- **Tunnel raw TCP over HTTPS** → `03-tunneling.md` §https-tunnel
- **Bounce traffic with iptables (no userland proxy)** → `03-tunneling.md` §iptables-bounce
- **Spoof a ghost IP inside target network** → `03-tunneling.md` §ghost-ip
- **SSH to host behind NAT** → `03-tunneling.md` §nat-traversal
- **Pivot through multiple hops** → `03-tunneling.md` §proxyjump
- **SSH invisibly (no w/who) + mux many shells on one conn** → `03-tunneling.md` §stealth-login

### Persist
- **Backdoor SSHD (survives apt update, no new file)** → `04-persistence.md` §sshd-backdoor
- **Smallest PHP backdoor** → `04-persistence.md` §php-backdoor
- **DNS-triggered implant (target not internet-reachable)** → `04-persistence.md` §dns-implant
- **Self-extracting implant** → `04-persistence.md` §mkegg
- **Local root backdoor** → `04-persistence.md` §local-root

### Stay hidden
- **Quiet shell (no history, clean env)** → `05-stealth.md` §hackshell
- **Hide process name / daemonize** → `05-stealth.md` §hide-process
- **Hide command-line options** → `05-stealth.md` §zapper
- **Hide a network connection from netstat** → `05-stealth.md` §hide-connection
- **Hide a PID (root, /proc over-mount)** → `05-stealth.md` §hide-pid
- **Hide lines from cat (ANSI/CR tricks)** → `05-stealth.md` §hide-from-cat
- **Shred/erase files, clear logs** → `05-stealth.md` §anti-forensics
- **Execute without touching disk (fileless)** → `05-stealth.md` §memexec
- **Work in volatile memory only** → `05-stealth.md` §devshm

### Exfiltrate / transfer files
- **Encode a file for cut-&-paste transfer** → `06-exfil.md` §encoding
- **Transfer via tmux/screen (no direct connection)** → `06-exfil.md` §terminal-transfer
- **Download without curl/wget** → `06-exfil.md` §no-curl
- **HTTP upload server (receiver)** → `06-exfil.md` §http-upload
- **rsync (large dirs, resumable)** → `06-exfil.md` §rsync
- **WebDAV share** → `06-exfil.md` §webdav
- **Exfil to Telegram** → `06-exfil.md` §telegram
- **SFTP through NAT via gsocket** → `06-exfil.md` §gsocket-sftp

### Crack & brute credentials
- **Brute-force an online service** → `07-creds.md` §brute-force
- **Crack a hash (hashcat)** → `07-creds.md` §hashcat
- **Crack a hash (john)** → `07-creds.md` §john
- **Pick a wordlist** → `07-creds.md` §wordlists
- **Crack known_hosts hashes → IPs** → `07-creds.md` §known-hosts

### Sniff & hijack sessions
- **Sniff a user's shell keystrokes** → `08-sniffing.md` §pty-sniff
- **Sniff all shells (eBPF, Linux)** → `08-sniffing.md` §ebpf
- **Sniff with strace (read/write)** → `08-sniffing.md` §strace
- **Hijack a running SSH session** → `08-sniffing.md` §reptyr

### Crypto & data protection
- **Generate a random password** → `09-crypto.md` §password-gen
- **Encrypted container (LUKS)** → `09-crypto.md` §luks
- **Encrypt a file (openssl)** → `09-crypto.md` §openssl-file

### Escalate privileges
- **Find SUID/SGID binaries** → `10-privesc.md` §suid
- **Find writable directories** → `10-privesc.md` §writable-dirs
- **Full local privesc sweep (linpeas)** → `10-privesc.md` §linpeas
- **Loader setcap root backdoor** → `10-privesc.md` §setcap-loader
- **Change user without sudo/su (root)** → `10-privesc.md` §xsu

### Evade detection / obfuscate payloads
- **Pack & obfuscate an ELF binary (UPX + header cleanse)** → `11-evasion.md` §upx
- **Run an obfuscated binary fileless** → `11-evasion.md` §memexec-recap

---

## Guide files

| File | Theme |
|---|---|
| `01-recon.md` | Discovery, scanning, host profiling, password grep |
| `02-shells.md` | Reverse/dumb shells, PTY upgrades |
| `03-tunneling.md` | SSH tunnels, SOCKS, HTTPS tunnels, bounces, pivoting |
| `04-persistence.md` | Backdoors, implants, self-extractors |
| `05-stealth.md` | Hiding, anti-forensics, fileless exec |
| `06-exfil.md` | File transfer & exfiltration |
| `07-creds.md` | Brute force, hash cracking, wordlists |
| `08-sniffing.md` | Session sniffing & hijacking |
| `09-crypto.md` | Passwords, encrypted volumes, file encryption |
| `10-privesc.md` | Local privilege escalation |
| `11-evasion.md` | Payload obfuscation, UPX/AV evasion, fileless exec |
