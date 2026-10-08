export interface Env {
  CONVEX_SITE_URL: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

export interface Route {
  path: RegExp;
  methods: string[];
}

/** Forwards a public page (privacy, delete-account, join) to Convex's HTTP actions; same behaviour as the old site Worker. */
export async function forwardToConvex({ request, env, next }: PagesContext, route: Route): Promise<Response> {
  const url = new URL(request.url);
  // Pages also routes /privacy/ and odd /join/<segment>s here; let those fall through to the static 404 page.
  if (!route.path.test(url.pathname)) return next();
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
}
