import { forwardToConvex, type PagesContext } from "../server/forward.ts";

export const onRequest = (context: PagesContext) =>
  forwardToConvex(context, { path: /^\/delete-account$/, methods: ["GET", "HEAD", "POST"] });
