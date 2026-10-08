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

## Deploying (Cloudflare Workers Builds)

The `nomadsafe-site` Worker is connected to the GitHub repo (Worker → Settings → Build):

| Setting | Value |
| --- | --- |
| Root directory | `website` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `npx wrangler deploy` |
| Build variable `SKIP_DEPENDENCY_INSTALL` | `1` (the build command does the install) |
| Build variable `NODE_VERSION` | `24` |
| Build variable `PNPM_VERSION` | `12.8.1` |

Because `website/` has its own `pnpm-workspace.yaml`, pnpm treats it as its own root. The install pulls in only the site's dependencies, pinned by `website/pnpm-lock.yaml`, and never the Expo app.

`wrangler.toml` holds everything else: the custom domain, the assets setup and `CONVEX_SITE_URL`. To deploy by hand, run `pnpm build && pnpm run deploy` (needs `wrangler login`).

## Demo phones

The hero phone runs a small copy of the app (`src/demo/`) on demo data. Everything happens on the page: there are no network requests and nothing is stored.

- **Trip tab:** a live WebGL globe (`src/components/globe/renderer.ts`, a port of the app's globe shader, loaded lazily) with the demo route.
- **Safety tab:** hold-to-SOS, a demo that sends nothing.
- **Money tab:** add and split a spend. The balance maths is in `src/demo/money.ts`.

The section phones reuse the mini app: Planning, Money and Safety each open on their own screen. Memories plays the recorded `public/clips/passport` clip (webm/mp4 with a jpg poster).

Under reduced motion, or without WebGL2, the globe shows `public/img/phone-globe.webp` instead. To recapture that still, open `/?globe=still`, screenshot the hero `.pglobe` element, and encode it with `cwebp`.

## Store badges

The badges read `STORE_LINKS` in `src/site.ts`. A `null` entry shows "Coming soon". At launch, set the URL (Play: `https://play.google.com/store/apps/details?id=com.pranav.nomadsafe`) and rebuild. Both the hero and the final call to action switch to a real "Get it on Google Play" / "Download on the App Store" link.
