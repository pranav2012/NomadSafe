# NomadSafe website

The marketing site at https://nomadsafe.pranav-agarwal.com, plus the public pages the app links to (`/privacy`, `/delete-account`, `/join/<code>`), which the Worker forwards to Convex.

- Vite + React + TypeScript, prerendered to static HTML at build time and then hydrated, so the page renders before any JavaScript runs. The hero globe's WebGL renderer (`src/components/globe/renderer.ts`) is a separate chunk loaded once the page is idle.
- `src/` holds the page components. `src/entry-server.tsx` renders them, and `scripts/prerender.mjs` writes `dist/index.html` and `dist/404.html`.
- `public/` is copied as is: fonts, images, screenshots, `_headers`, `robots.txt`.
- `worker/index.ts` is the Worker. Static files are served first; the Worker runs only for `/privacy`, `/delete-account` and `/join/*` (`run_worker_first` in `wrangler.toml`), forwarding them to `CONVEX_SITE_URL`. Anything else falls through to `404.html` (`not_found_handling = "404-page"`).

## Local development

The site is its own pnpm project (`pnpm-workspace.yaml` and `pnpm-lock.yaml` live here), separate from the app's install. In `website/`, run `pnpm install` once, then:

```sh
pnpm dev        # Vite dev server; pages are server-rendered like the build
pnpm build      # dist/ (index.html, 404.html, assets)
pnpm preview    # wrangler dev: the built site plus the Worker; no Cloudflare login needed
pnpm typecheck
```

`pnpm dev` doesn't run the Worker; use `pnpm preview` for `/privacy`, `/delete-account` and `/join/<code>`.

## Deploying

Deploy from your machine (needs `npx wrangler login` once):

```sh
pnpm run deploy   # builds, then uploads the nomadsafe-site Worker and its assets
```

`wrangler.toml` holds the custom domain, the assets setup and `CONVEX_SITE_URL`.

The Worker is also connected to GitHub (Workers Builds), which only builds `main`. Its settings: root directory `website`, build command `pnpm install --frozen-lockfile && pnpm build`, deploy command `npx wrangler deploy`, build variables `SKIP_DEPENDENCY_INSTALL=1`, `NODE_VERSION=24`, `PNPM_VERSION=12.8.1`.

## Demo phones

The hero phone runs a small copy of the app (`src/demo/`) on demo data. Everything happens on the page: there are no network requests and nothing is stored.

- **Trip tab:** a live WebGL globe (`src/components/globe/renderer.ts`, a port of the app's globe shader, loaded lazily) with the demo route.
- **Safety tab:** hold-to-SOS, a demo that sends nothing.
- **Money tab:** add and split a spend. The balance maths is in `src/demo/money.ts`.

The section phones reuse the mini app: Planning, Money and Safety each open on their own screen. Memories plays the recorded `public/clips/passport` clip (webm/mp4 with a jpg poster).

Under reduced motion, or without WebGL2, the globe shows `public/img/phone-globe.webp` instead. To recapture that still, open `/?globe=still`, screenshot the hero `.pglobe` element, and encode it with `cwebp`.

## Store badges

The badges read `STORE_LINKS` in `src/site.ts`. A `null` entry shows "Coming soon". At launch, set the URL (Play: `https://play.google.com/store/apps/details?id=com.pranav.nomadsafe`) and rebuild. Both the hero and the final call to action switch to a real "Get it on Google Play" / "Download on the App Store" link.
