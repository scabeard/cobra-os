# 09 — Crypto

> Authorized use only. Protect loot and 0-days in transit and at rest.

---

## §password-gen — Quick random password

```bash
openssl rand -base64 24
# no openssl:
head -c 32 < /dev/urandom | xxd -p -c 32
# alpha-numeric only:
head -c 32 < /dev/urandom | base64 | tr -dc '[:alnum:]' | head -c 16
```

---

## §luks — Transportable encrypted filesystem (LUKS)

**Create a 256MB encrypted container:**
```bash
dd if=/dev/urandom of=/tmp/crypted bs=1M count=256 iflag=fullblock
cryptsetup luksFormat /tmp/crypted
cryptsetup open /tmp/crypted sec
mkfs -t ext3 /dev/mapper/sec
```

**Mount:**
```bash
cryptsetup open /tmp/crypted sec
mount -o nofail,noatime /dev/mapper/sec /mnt/sec
```

**Unmount:**
```bash
umount /mnt/sec
cryptsetup close sec
```

**EncFS alternative (no root):**
```bash
mkdir .raw .sec
encfs --standard "${PWD}/.raw" "${PWD}/.sec"
# unmount: fusermount -u .sec
```

---

## §openssl-file — Encrypt a file

```bash
# encrypt:
openssl enc -aes-256-cbc -pbkdf2 -k 'YOUR-PASSWORD' <input.txt >input.txt.enc
# decrypt:
openssl enc -d -aes-256-cbc -pbkdf2 -k 'YOUR-PASSWORD' <input.txt.enc >input.txt
```
Encrypt log files and sensitive loot before transferring. Pick your own strong password.
