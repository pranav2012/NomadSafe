const ROUTES = [
  { path: /^\/privacy$/, methods: ["GET", "HEAD"] },
  { path: /^\/delete-account$/, methods: ["GET", "HEAD", "POST"] },
  { path: /^\/join\/[A-Za-z0-9]{1,16}\/?$/, methods: ["GET", "HEAD"] },
];

/** Forwards the public pages to Convex's HTTP actions; everything else (auth, AI, webhooks) stays on convex.site. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.path.test(url.pathname));
    if (!route) return new Response("Not found", { status: 404 });
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
