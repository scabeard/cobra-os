# cobra-os.com — COBRA OS website

Static site for **Cloudflare Pages**, themed on the COBRA OS console palette
(`shell/cobra-theme.sh`). No build step, no frameworks, no analytics, no
external requests — pure HTML/CSS/JS, exactly the way the OS would want it.

## The hosting picture

```
GitHub repo (this repo, website/)
        │  push to default branch
        ▼
Cloudflare Pages ──────────────► cobra-os.com        (the site + the /shell/ mirror)

Cloudflare R2 bucket ──────────► dl.cobra-os.com     (the ISOs + gs-netcat binaries)

Home server (gsocket relay) ───► relay.cobra-os.com  (gs-* rendezvous)
        └─ tor hidden service ─► <addr>.onion        (site + /shell/ mirror over Tor)
```
Three different jobs, three different homes:

- **Pages hosts the site AND the operator-shell mirror.** Free, unlimited
  bandwidth, git-integrated — but a hard **25 MiB per-file limit**. The shell
  scripts are kilobytes; they deploy with the site. A 2.4 GiB ISO can never
  live here — that's the "Cloudflare doesn't do that" part. Pages is also the
  answer to "host it ourselves without exposing our home IP": there is **no
  origin server** — Cloudflare's edge holds the files, so no IP of ours ever
  appears in DNS or answers a connection.
- **R2 hosts the big/binary things.** S3-compatible object storage in the same
  Cloudflare account, **zero egress fees**, free tier covers ~10 GB stored:
  the ISOs at the root, the static gs-netcat builds under `/bin/`. Attach the
  `dl.cobra-os.com` custom domain to the bucket and every download is a plain
  HTTPS URL.
- **The home server runs the gsocket relay and the Tor mirror.** It is our own
  hardware on our own network — so **nothing clearnet ever points at it**.
  `relay.cobra-os.com` is the one exception (a single outbound-reachable
  port); everything else it serves is Tor-only, because onion services hide
  the host's IP by design. See "The Tor mirror (.onion)" below. If the
  clearnet site ever needs to come home too, the only safe way is a
  Cloudflare Tunnel — see "Serving clearnet from home" below.
- **GitHub Releases** is only a fallback for ISOs: assets cap at **2 GiB**,
  and the current 2.4 GiB image already exceeds that (it would need `split`
  chunks). R2 is the primary home.

## Layout

```
index.html                     the whole site (single page, anchored sections)
404.html                       not-found page
_headers                       Cloudflare Pages security headers + cache rules
_redirects                     /cobrashell.sh -> /shell/cobrashell.sh (200 rewrite)
assets/css/style.css           the COBRA dark theme (palette from cobra-theme.sh)
assets/js/main.js              typed hero terminal + mobile nav (vanilla, offline)
assets/img/cobra-logo.png      logo (copy of ../Cobras-OS.png)
shell/                         the operator-shell mirror — synced from ../shell/ by
                               sync-shell.sh, committed with the site (see below)
downloads/                     .sha256 sidecars only — *.iso is gitignored (they live on R2)
release.sh                     stage a new build: verify, copy sha256, rewrite index.html,
                               sync the shell mirror
sync-shell.sh                  mirror ../shell/ into shell/ (bash -n checked, pruned)
```

## The shell mirror (cobra-os.com/shell/)

The same files the OS installs to `/etc/cobra/` are served from
`cobra-os.com/shell/`, so the operator shell loads on any box when the OS
isn't booted (HTB, VulnHub, a jumped host):

```bash
source <(curl -fsSL https://cobra-os.com/shell/cobrashell.sh)
# or the short URL (a Pages 200 rewrite in _redirects):
source <(curl -fsSL https://cobra-os.com/cobrashell.sh)
```

Mirrored files: `cobrashell.sh` + the vendored helpers its functions can use
on a foreign box (`ghostip.sh`, `whatserver.sh`, `mkegg.sh`, `linpeas.sh`,
`upload_server.php`). `cobra-ops.sh` / `cobra-theme.sh` stay OS-only (they
assume the COBRA toolset / a Linux TTY). `_headers` serves `/shell/*` as
`text/plain` with a 5-minute cache.

**`../shell/` is the source of truth — never edit `website/shell/` directly.**
After changing anything in `../shell/`:

```bash
website/sync-shell.sh     # bash -n checks each script, copies on change, prunes strays
```

`release.sh` calls it automatically, so a release always ships the current
shell. Commit the mirror with the site.

## One-time setup

### 1. GitHub → Cloudflare Pages (the site)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to
   Git**, pick the repo.
3. Build settings: **Framework preset: None**, **build command: (empty)**,
   **build output directory: `website`** (plain static files, nothing to
   compile).
4. Pages project → **Custom domains** → add **cobra-os.com** (and `www` if
   wanted). The domain is already on Cloudflare, so DNS + TLS are automatic.

Every push to the default branch redeploys the site. Direct-upload
alternative (no git link):

```bash
npx wrangler pages deploy website --project-name cobra-os
```

### 2. R2 bucket (the builds + the gs-netcat binaries)

1. Cloudflare dashboard → **R2 → Create bucket** — e.g. `cobra-os-downloads`.
2. Bucket → **Settings → Public access → Custom domains** → attach
   **dl.cobra-os.com** (managed TLS, automatic).
3. Upload credentials: **R2 → Manage R2 API Tokens** → create a token, then
   `rclone config`:

```
[r2]
type = s3
provider = Cloudflare
access_key_id = <token access key id>
secret_access_key = <token secret>
endpoint = https://<account-id>.r2.cloudflarestorage.com
```

(`aws s3 --endpoint-url …` or the dashboard upload button work too — rclone
is just the smoothest for multi-GB objects.)

## Shipping a new build

```bash
sudo ./build-iso.sh                             # → cobra-os-<date>.iso + .sha256
website/release.sh cobra-os-<date>.iso          # verify + stage + rewrite index.html + sync shell mirror
rclone copyto cobra-os-<date>.iso \
    r2:cobra-os-downloads/cobra-os-<date>.iso --progress
rclone copyto cobra-os-<date>.iso.sha256 \
    r2:cobra-os-downloads/cobra-os-<date>.iso.sha256
git add website && git commit -m "release cobra-os-<date>" && git push
```

`release.sh` refuses to stage an image whose checksum doesn't verify, copies
the `.sha256` into `downloads/`, and rewrites every ISO filename/size
reference in `index.html` (download card, verify example, hero stat). Old
builds can stay in the bucket (storage is cheap) or be pruned with
`rclone delete r2:cobra-os-downloads/cobra-os-<olddate>.iso*`.

## The gs-netcat binaries (dl.cobra-os.com/bin/)

cobrashell's `bin gs-netcat`, the `memexec` examples, and the site's relay
section all fetch gs-netcat from **our** bucket — not THC's GitHub. Mirror
the upstream static builds, byte-for-byte, with checksum sidecars:

```bash
for f in gs-netcat_linux-x86_64 gs-netcat_linux-i686 gs-netcat_linux-aarch64; do
    curl -fsSLO "https://github.com/hackerschoice/gsocket/releases/latest/download/$f"
    sha256sum "$f" > "$f.sha256"
    rclone copyto "$f"        "r2:cobra-os-downloads/bin/$f" --progress
    rclone copyto "$f.sha256" "r2:cobra-os-downloads/bin/$f.sha256"
done
```

The object names must match the upstream release names exactly —
cobrashell builds the URL as `dl.cobra-os.com/bin/gs-netcat_${os}-${HS_ARCH}`
(`linux-x86_64`, `linux-i686`, `linux-aarch64`). Verify after upload:

```bash
curl -fsSLO https://dl.cobra-os.com/bin/gs-netcat_linux-x86_64
curl -fsSLO https://dl.cobra-os.com/bin/gs-netcat_linux-x86_64.sha256
sha256sum -c gs-netcat_linux-x86_64.sha256
```

## The gsocket relay (relay.cobra-os.com)

The home server runs the relay daemon from
[hackerschoice/gsocket](https://github.com/hackerschoice/gsocket), so the
`gs-*` tools never depend on third-party infrastructure:

```bash
# docker — the published relay image:
docker run -d --restart unless-stopped -p 7350:7350 hackerschoice/gsocket-relay
# or the relay daemon from the gsocket repo: gsocket -s  (listens on TCP/7350)
```

One TCP port; both ends connect *outbound* to the relay, streams are
end-to-end encrypted (SRP) — the relay only ever sees ciphertext. Operators
point at it explicitly (`export GS_HOST=relay.cobra-os.com GS_PORT=7350`
after `xint`); the OS default stays the public relay network — nothing calls
home to COBRA infra on its own.

`relay.cobra-os.com` is the **only** clearnet record that points at the home
box — a single TCP port, ciphertext-only. Everything else the box serves is
Tor-only (next section). A second hidden service can later front the relay
itself (`HiddenServicePort 7350 127.0.0.1:7350` with the daemon bound to
localhost) so the whole toolchain is reachable without any clearnet record
at all.

## The Tor mirror (.onion)

The self-hosted half of the hosting picture: a tor **hidden service** on the
home server serving a read-only copy of this site. Onion services hide the
host's IP by design — tor rendezvous means the server never reveals its
address — so this is the one place serving from home is safe. Nothing
clearnet (no A/AAAA record, no Cloudflare origin) ever points at the box.

### 1. The hidden service (torrc)

```ini
# /etc/tor/torrc
HiddenServiceDir /var/lib/tor/cobra-site/
HiddenServicePort 80 127.0.0.1:8080
```

`systemctl reload tor`, then the address is in
`/var/lib/tor/cobra-site/hostname`. The service only ever talks to
**127.0.0.1:8080** — the web server must bind localhost, never the LAN or
public interface.

### 2. The localhost web server

Anything that can serve static files works. Minimal option:

```bash
cd /srv/cobra-site && python3 -m http.server 8080 --bind 127.0.0.1
```

or nginx bound to localhost:

```nginx
server {
    listen 127.0.0.1:8080;
    root /srv/cobra-site;
    # mirror the Pages _headers policy (CSP etc.) here with add_header —
    # see the nginx equivalents in "Serving clearnet from home" below
}
```

Serve the site + the `/shell/` mirror + the `downloads/*.sha256` checksums.
**ISOs stay on R2** — the download links keep pointing at
`https://dl.cobra-os.com/…`. Multi-GB over Tor is miserable and R2 egress is
free; the onion carries the small stuff.

### 3. Keeping the mirror current

The onion serves the same tree Pages deploys, pushed over after a release:

```bash
rsync -a --delete website/ home-server:/srv/cobra-site/
```

(hook it into the end of `release.sh`, or a `git pull` + cron on the server —
either way the onion always ships the current build and the current shell
mirror.)

### 4. Advertising it

Once the address exists, uncomment the `Onion-Location` line in `_headers` —
Tor Browser then offers the onion automatically to clearnet visitors.

## Serving clearnet from home: Cloudflare Tunnel

Pages is the default for `cobra-os.com` and should stay that way — no origin
to patch, no daemon to babysit, `_headers`/`_redirects` are native. But if
the clearnet site ever needs to be served by the home box itself, a
**Cloudflare Tunnel** is the only safe way to do it. **Never** port-forward
the router or put a home IP in DNS — that exposes the address instantly and
permanently (DNS history is forever).

Why Tunnel works: `cloudflared` on the home box dials **outbound-only** to
Cloudflare's edge and keeps the connection open. Cloudflare answers the
public request and shuffles it down the tunnel. No public IP needed, no open
ports, works behind NAT/CGNAT, and the home IP never appears anywhere.

### Setup

```bash
# install cloudflared (Cloudflare's apt repo or the release .deb), then:
cloudflared tunnel login                 # browser auth → cert.pem
cloudflared tunnel create cobra-site     # → tunnel UUID + credentials JSON
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /root/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: cobra-os.com
    service: http://127.0.0.1:8080
  - hostname: www.cobra-os.com
    service: http://127.0.0.1:8080
  - service: http_status:404        # catch-all, required last
```

Route DNS and run it as a service:

```bash
cloudflared tunnel route dns cobra-site cobra-os.com
cloudflared tunnel route dns cobra-site www.cobra-os.com
cloudflared service install          # systemd unit, starts on boot
systemctl enable --now cloudflared
```

The local server on `127.0.0.1:8080` is the same one the onion uses — one
docroot, two front doors (Tunnel for clearnet, tor for onion).

### The trade-off

Tunnel mode means **you** replicate what Pages did for free:

- The `_headers` security policy must move into the local server config.
  nginx equivalents of the Pages block:

  ```nginx
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;
  add_header Cross-Origin-Opener-Policy same-origin always;
  add_header Cross-Origin-Resource-Policy same-origin always;
  add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" always;
  ```

- The `_redirects` `/cobrashell.sh` rewrite becomes an nginx `location` /
  `rewrite` rule.
- Deploys stop being `git push` — the box needs the same rsync/git-pull sync
  the onion uses.
- The box is now on the clearnet critical path: if it's down, the site is
  down. Pages doesn't have that problem.

## Local preview

```bash
cd website && python3 -m http.server 8080
# → http://127.0.0.1:8080
```
