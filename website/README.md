# NomadSafe website

The marketing site at https://nomadsafe.pranav-agarwal.com, plus the public pages the app links to (`/privacy`, `/delete-account`, `/join/<code>`), which Pages Functions forward to Convex.

- Vite + React + TypeScript, prerendered to static HTML at build time. The built site ships no JavaScript.
- `src/` holds the page components. `src/entry-server.tsx` renders them, and `scripts/prerender.mjs` writes `dist/index.html` and `dist/404.html`.
- `public/` is copied as is: fonts, images, screenshots, `_headers`, `robots.txt`.
- `functions/` contains the Pages Functions. They share `server/forward.ts`, which forwards to `CONVEX_SITE_URL` (set in `wrangler.toml`).

## Local development

The site is its own pnpm project (`pnpm-workspace.yaml` and `pnpm-lock.yaml` live here), separate from the app's install. In `website/`, run `pnpm install` once, then:

```sh
pnpm dev        # Vite dev server; pages are server-rendered like the build
pnpm build      # dist/ (index.html, 404.html, assets)
pnpm preview    # wrangler pages dev dist: the built site plus the Functions; no Cloudflare login needed
pnpm typecheck
```

`pnpm dev` doesn't run the Functions; use `pnpm preview` for `/privacy`, `/delete-account` and `/join/<code>`.

## Cloudflare Pages (Git integration)

| Setting | Value |
| --- | --- |
| Root directory | `website` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Build output directory | `dist` |
| Env var `SKIP_DEPENDENCY_INSTALL` | `1` (stops Cloudflare's automatic install at the repo root) |
| Env var `NODE_VERSION` | `24` |
| Env var `PNPM_VERSION` | `12.8.1` |

Because `website/` has its own `pnpm-workspace.yaml`, pnpm treats it as its own root. The install pulls in only the site's dependencies, pinned by `website/pnpm-lock.yaml`, and never the Expo app.

`wrangler.toml` is the source of truth for the project name, the compatibility date and `CONVEX_SITE_URL`. Pages shows those values in the dashboard as read-only.

## Screenshots

The phone frames show `public/screens/*.png` at a 9:19.5 aspect ratio with `object-fit: cover`. The `<img>` sizes come from `SCREEN` in `src/site.ts`.

| File | Shown in |
| --- | --- |
| `home.png` | Hero |
| `itinerary.png` | Planning |
| `replay.png` | Memories (front phone) |
| `passport.png` | Memories (back phone) |
| `money.png` | Money |
| `safety.png` | Safety |

Replace the files with 1440×3120 PNGs (Pixel captures) under the same names, then rebuild. Photo credits for screenshots go in `src/components/Footer.tsx`. If you add another screen, also update the alt text in `src/components/Features.tsx`.

## Store badges

The badges read `STORE_LINKS` in `src/site.ts`. A `null` entry shows "Coming soon". At launch, set the URL (Play: `https://play.google.com/store/apps/details?id=com.pranav.nomadsafe`) and rebuild. Both the hero and the final call to action switch to a real "Get it on Google Play" / "Download on the App Store" link.
