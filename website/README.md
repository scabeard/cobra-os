# cobra-os.com — COBRA OS website

Static site for **Cloudflare Pages**, themed on the COBRA OS console palette
(`shell/cobra-theme.sh`). No build step, no frameworks, no analytics, no
external requests — pure HTML/CSS/JS, exactly the way the OS would want it.

## The hosting picture

```
GitHub repo (this repo, website/)
        │  push to default branch
        ▼
Cloudflare Pages ──────────────► cobra-os.com      (the site — HTML/CSS/JS only)

Cloudflare R2 bucket ──────────► dl.cobra-os.com   (the ISOs + .sha256 mirrors)
```

Two different Cloudflare products, two different jobs:

- **Pages hosts the site.** Free, unlimited bandwidth, git-integrated — but a
  hard **25 MiB per-file limit**. A 2.4 GiB ISO can never live in the repo or
  the Pages deploy. This is the "Cloudflare doesn't do that" part — correct,
  Pages doesn't host builds.
- **R2 hosts the builds.** S3-compatible object storage in the same
  Cloudflare account and dashboard, **zero egress fees**, free tier covers
  ~10 GB stored. Attach the `dl.cobra-os.com` custom domain to the bucket and
  the download button is a plain HTTPS URL.
- **GitHub Releases** is only a fallback: assets cap at **2 GiB**, and the
  current 2.4 GiB image already exceeds that (it would need `split` chunks).
  R2 is the primary home for ISOs.

## Layout

```
index.html                     the whole site (single page, anchored sections)
404.html                       not-found page
_headers                       Cloudflare Pages security headers + cache rules
assets/css/style.css           the COBRA dark theme (palette from cobra-theme.sh)
assets/js/main.js              typed hero terminal + mobile nav (vanilla, offline)
assets/img/cobra-logo.png      logo (copy of ../Cobras-OS.png)
assets/img/splash.png          boot splash (copy of ../splash.png)
downloads/                     .sha256 sidecars only — *.iso is gitignored (they live on R2)
release.sh                     stage a new build: verify, copy sha256, rewrite index.html
```

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

### 2. R2 bucket (the builds)

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
website/release.sh cobra-os-<date>.iso          # verify + stage + rewrite index.html
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

## The gsocket relay (relay.cobra-os.com)

Separate from the site entirely: a small VPS running the relay daemon from
[hackerschoice/gsocket](https://github.com/hackerschoice/gsocket) so the
`gs-*` tools never depend on third-party infrastructure. See the **relay**
section on the site — `GS_HOST`/`GS_PORT` in the operator shell point all
gsocket traffic at it, and the `egg` wizard's beacon mode threads them into
payloads.

## Local preview

```bash
cd website && python3 -m http.server 8080
# → http://127.0.0.1:8080
```
