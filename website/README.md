# cobra-os.com — COBRA OS website

Static site for **Cloudflare Pages**, themed on the COBRA OS console palette
(`shell/cobra-theme.sh`). No build step, no frameworks, no analytics, no
external requests — pure HTML/CSS/JS, exactly the way the OS would want it.

## The hosting picture

```
GitHub repo (this repo, website/)
        │  push to default branch
        ▼
Cloudflare Pages ──────────────► cobra-os.com        (clearnet: the site +
                                                      /shell/ + /cobra/ mirrors)

Home server (gsocket relay) ───► relay.cobra-os.com  (gs-* rendezvous)
        └─ tor hidden service ─► afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion        (the SAME site + /shell/ +
                                                      /cobra/  +  bin/gs-netcat_* — over Tor)
```

Two front doors, one tree — plus the small binaries, Tor-only:

- **Pages hosts the clearnet site AND the small mirrors.** Free, unlimited
  bandwidth, git-integrated — but a hard **25 MiB per-file limit**. The site,
  the operator-shell mirror (`/shell/`), and the CobraStrike client
  (`/cobra/`, ~600 KB) all fit and deploy with a push. There is **no origin
  server** — Cloudflare's edge holds the files, so no IP of ours ever appears
  in DNS or answers a connection. The clearnet is the brochure everyone can
  see.
- **The .onion hosts the bytes the clearnet shouldn't.** A tor hidden service
  on the home server serves the **same tree Pages deploys**, **plus** the
  static **gs-netcat binaries** (`/bin/`). Onion services hide the host's IP
  by design, so this is the one place serving from home is safe.
- **The home server also runs the gsocket relay.** It is our own hardware on
  our own network — so **nothing clearnet ever points at it** except the
  single outbound-reachable `relay.cobra-os.com` port. Everything else it
  serves is Tor-only. See "The gsocket relay" below.

**No hosted ISO — build it yourself.** COBRA OS no longer ships a prebuilt
live image. A hardened red-team OS shouldn't ask operators to trust someone
else's build machine, onion key, or Tor path for a multi-GB binary — and with
the `COBRA_PROFILES` matrix (core, wireless, ad, exploit, webplus, ai) there's
no single "default" image worth hosting. Everyone builds from the same
`build-iso.sh` we run, on their own host, in their chosen profile. We publish
the **reference build's `.sha256`** (`downloads/`) so you can compare your
build's hash against ours. What stays hosted are the small, one-command
installs: the shell mirror, the CobraStrike operator, and the `gs-netcat`
binaries. **No R2, no object storage, no third-party download host.**

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
cobra/                         the CobraStrike client mirror — synced from
                               ../CobraStrike/cobra-client/ by sync-cobra.sh
                               (install.sh + latest/cobra.js), committed with the site
downloads/                     .sha256 sidecars only — *.iso is gitignored
                               (ISOs ship from the .onion, never from Pages/git)
bin/                           (onion-only) static gs-netcat builds + .sha256 —
                               NOT committed; staged on the home server
release.sh                     stage a new build: verify, copy sha256, rewrite
                               index.html, sync the shell + cobra mirrors
sync-shell.sh                  mirror ../shell/ into shell/ (bash -n checked, pruned)
sync-cobra.sh                  mirror ../CobraStrike/cobra-client/ into cobra/
onion-sync.sh                  rsync the tree (+ ISO + bin/) to the home server
                               for the .onion to serve
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

## The CobraStrike mirror (cobra-os.com/cobra/)

**CobraStrike** is COBRA's self-contained, headless AI agent — it drives the
`cobra-mcp` MCP server with any OpenRouter model, using **your own API key**
(never this site's). The client bundles to a single `cobra.js`, served from
`cobra-os.com/cobra/` so it installs on any box with a one-liner:

```bash
curl -fsSL https://cobra-os.com/cobra/install.sh | bash
# then bring your own OpenRouter key:
cobra setup --save-key     # stored 0600, never sent here
cobra run "Recon triage the active target"
```

The `#cobrastrike` section of `index.html` is the human reference: it documents
the full operator CLI (7 subcommands + flags) and the agent's 27 MCP tools
(grouped by category), alongside the resources/prompts read-side. Keep it in
sync with `../CobraStrike/BUILD_PLAN.md` §2/§4 (the authoritative tool
manifest) whenever the client CLI or the `cobra-mcp` tool set changes.

Mirrored files: `install.sh` + `latest/cobra.js` (the esbuild single-file
bundle, ~600 KB — well under the Pages cap, so it ships on **both** the
clearnet site and the onion). `_headers` serves `install.sh` as `text/plain`
and `cobra.js` as `application/javascript`.

**`../CobraStrike/cobra-client/` is the source of truth — never edit
`website/cobra/` directly.** After changing the client or its installer:

```bash
website/sync-cobra.sh     # bash -n the installer, rebuild the bundle if stale, copy
```

`sync-cobra.sh` rebuilds `dist/cobra.js` (via `npm run bundle`) whenever the
client's `src/` is newer than the bundle, so the mirror never ships a stale
agent. `release.sh` calls it automatically. Commit the mirror with the site.

The API key is resolved client-side (flag → env → `0600` file → hidden
prompt), held only in memory, and sent solely to OpenRouter over HTTPS. The
site hosts the bundle — **never** the key, and there is no telemetry or
phone-home in the installer or the agent.

## One-time setup

### 1. GitHub → Cloudflare Pages (the clearnet site)

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

## Shipping a new build

```bash
sudo ./build-iso.sh                             # → cobra-os-<date>.iso + .sha256
website/release.sh cobra-os-<date>.iso          # verify + stage + rewrite index.html
                                                # + sync the shell & cobra mirrors
website/onion-sync.sh cobra-os-<date>.iso       # publish site + ISO to the .onion
git add website && git commit -m "release cobra-os-<date>" && git push
```

`release.sh` refuses to stage an image whose checksum doesn't verify, copies
the `.sha256` into `downloads/`, and rewrites every ISO filename/size
reference in `index.html` (download card, verify example, hero stat).
`onion-sync.sh` then rsyncs the whole tree — site, `/shell/`, `/cobra/`,
`/bin/`, and the staged ISO — to the home server's docroot over SSH/Tor. Old
builds can stay on the server (disk is cheap) or be pruned by deleting the
file from `/srv/cobra-site/downloads/`.

## The gs-netcat binaries (afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/bin/)

cobrashell's `bin gs-netcat`, the `memexec` examples, and the site's relay
section all fetch gs-netcat from **our** onion — not THC's GitHub, not a
clearnet host. Mirror the upstream static builds, byte-for-byte, with
checksum sidecars, onto the home server:

```bash
for f in gs-netcat_linux-x86_64 gs-netcat_linux-i686 gs-netcat_linux-aarch64; do
    curl -fsSLO "https://github.com/hackerschoice/gsocket/releases/latest/download/$f"
    sha256sum "$f" > "$f.sha256"
    rsync -a "$f" "$f.sha256" cobra-site:/srv/cobra-site/bin/   # via onion-sync's transport
done
```

The object names must match the upstream release names exactly —
cobrashell builds the URL as `afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/bin/gs-netcat_${os}-${HS_ARCH}`
(`linux-x86_64`, `linux-i686`, `linux-aarch64`). Verify after upload (over Tor):

```bash
torsocks curl -fsSLO http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/bin/gs-netcat_linux-x86_64
torsocks curl -fsSLO http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion/bin/gs-netcat_linux-x86_64.sha256
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

## The Tor mirror (.onion) — the download host

This is the half that actually ships the bytes. A tor **hidden service** on
the home server serves a read-only copy of this site **plus** the ISO and the
gs-netcat binaries. Onion services hide the host's IP by design — tor
rendezvous means the server never reveals its address — so this is the one
place serving from home is safe. Nothing clearnet (no A/AAAA record, no
Cloudflare origin) ever points at the box.

### 1. The hidden service (torrc)

```ini
# /etc/tor/torrc
HiddenServiceDir /var/lib/tor/cobra-site/
HiddenServicePort 80 127.0.0.1:8080
```

`systemctl reload tor`, then the address is in
`/var/lib/tor/cobra-site/hostname`. The service only ever talks to
**127.0.0.1:8080** — the web server must bind localhost, never the LAN or
public interface. Drop the address into the site: replace every
`afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion` placeholder in `index.html`, `release.sh`, and `onion-sync.sh`
with the real one, and uncomment the `Onion-Location` line in `_headers` (see
"Advertising it" below).

### 2. The localhost web server (multi-GB capable)

The onion serves the ISO, so the static server must handle **large files** and
**HTTP range requests** (so `curl -C -` can resume a multi-GB Tor download that
drops mid-way). Use nginx bound to localhost — not `python3 -m http.server`
(it's single-threaded and flaky on big ranges):

```nginx
# /etc/nginx/sites-available/cobra-onion
server {
    listen 127.0.0.1:8080;
    server_name _;
    root /srv/cobra-site;

    # large-file delivery: kernel sendfile + byte ranges (resumable over Tor)
    sendfile on;
    tcp_nopush on;
    aio threads;
    directio 512k;                 # bypass page cache for big files
    max_ranges 1;                  # allow single-range resume (curl -C -)
    disable_symlinks if_not_owner from=$document_root;

    # mirror the Pages _headers security policy
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Resource-Policy same-origin always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" always;

    location /shell/  { default_type text/plain; }
    location /cobra/  { }
    location /cobra/install.sh { default_type text/plain; }
    location /downloads/ { }
    location /bin/ { autoindex on; }   # list the gs-netcat builds + .sha256

    # the /cobrashell.sh short URL (Pages _redirects equivalent)
    location = /cobrashell.sh {
        default_type text/plain;
        alias /srv/cobra-site/shell/cobrashell.sh;
    }
}
```

Enable it and keep it localhost-only:

```bash
ln -s /etc/nginx/sites-available/cobra-onion /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
ss -ltnp | grep 8080     # must show 127.0.0.1:8080 — never 0.0.0.0
```

### 3. Keeping the mirror current

The onion serves the same tree Pages deploys, plus the ISO and `bin/`, pushed
over after a release:

```bash
website/onion-sync.sh cobra-os-<date>.iso    # stage + rsync everything over Tor/SSH
```

`onion-sync.sh` rsyncs `website/` → `home-server:/srv/cobra-site/` with
`--delete`, over SSH wrapped in `torsocks` (so the sync itself never exposes
the server's IP). Set `ONION_SSH` / `ONION_ROOT` / `USE_TORSOCKS` for your
box. Hook it into the end of a release (see "Shipping a new build") and the
onion always ships the current build, the current shell mirror, and the
current CobraStrike bundle.

### 4. Advertising it

Once the address exists, replace the `afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion` placeholders and uncomment
the `Onion-Location` block in `_headers` — Tor Browser then offers the onion
automatically to clearnet visitors:

```
/*
  Onion-Location: http://afrt77bagg4l4r6k56kshbbxjb6oot6dg7gwt3g5jopk4pe7ddjv3zad.onion$request_uri
```

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
docroot, two front doors (Tunnel for clearnet, tor for onion). Keep the ISO
out of the Tunnel path if you don't want multi-GB flowing through Cloudflare
— the onion is the download host regardless.

### The trade-off

Tunnel mode means **you** replicate what Pages did for free:

- The `_headers` security policy must live in the nginx config (the onion
  block above already has it).
- The `_redirects` `/cobrashell.sh` rewrite becomes the nginx `alias` rule
  (also already in the block above).
- Deploys stop being `git push` — the box needs the same rsync/git-pull sync
  the onion uses (`onion-sync.sh`).
- The box is now on the clearnet critical path: if it's down, the site is
  down. Pages doesn't have that problem.

## Local preview

```bash
cd website && python3 -m http.server 8080
# → http://127.0.0.1:8080
```
