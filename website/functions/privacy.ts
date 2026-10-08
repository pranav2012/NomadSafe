import { forwardToConvex, type PagesContext } from "../server/forward.ts";

export const onRequest = (context: PagesContext) =>
  forwardToConvex(context, { path: /^\/privacy$/, methods: ["GET", "HEAD"] });
