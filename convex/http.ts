import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { publishLocationHttp } from "./sharing";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/api/sharing/publish",
  method: "POST",
  handler: publishLocationHttp,
});

export default http;
