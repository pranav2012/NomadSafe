interface Env {
  CONVEX_SITE_URL: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const ROUTES = [
  { path: /^\/privacy$/, methods: ["GET", "HEAD"] },
  { path: /^\/delete-account$/, methods: ["GET", "HEAD", "POST"] },
  { path: /^\/join\/[A-Za-z0-9]{1,16}\/?$/, methods: ["GET", "HEAD"] },
  { path: /^\/circle\/[A-Za-z0-9]{1,16}\/?$/, methods: ["GET", "HEAD"] },
];

/** Runs only for the paths in `run_worker_first`: forwards the public pages to Convex's HTTP actions; anything else gets the static 404 page. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.path.test(url.pathname));
    if (!route) return env.ASSETS.fetch(request);
    if (!route.methods.includes(request.method)) return new Response("Method not allowed", { status: 405 });

    const headers = new Headers(request.headers);
    // The delete-account form rate-limits by the first X-Forwarded-For entry.
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-forwarded-for", ip);
    headers.delete("cookie");

    return fetch(new URL(url.pathname + url.search, env.CONVEX_SITE_URL), {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
      redirect: "manual",
    });
  },
};
