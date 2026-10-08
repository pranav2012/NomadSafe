import { forwardToConvex, type PagesContext } from "../../server/forward.ts";

export const onRequest = (context: PagesContext) =>
  forwardToConvex(context, { path: /^\/join\/[A-Za-z0-9]{1,16}\/?$/, methods: ["GET", "HEAD"] });
