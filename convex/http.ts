import { httpRouter } from "convex/server";
import { chatStream } from "./ai";
import { authComponent, createAuth } from "./auth";
import { revenueCatWebhook } from "./billing";
import { deleteAccountPage, joinCirclePage, joinTripPage, privacyPolicy, submitDeletionRequest } from "./legalPages";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

http.route({ path: "/privacy", method: "GET", handler: privacyPolicy });
http.route({ path: "/delete-account", method: "GET", handler: deleteAccountPage });
http.route({ path: "/delete-account", method: "POST", handler: submitDeletionRequest });
http.route({ pathPrefix: "/join/", method: "GET", handler: joinTripPage });
http.route({ pathPrefix: "/circle/", method: "GET", handler: joinCirclePage });
http.route({ path: "/revenuecat/webhook", method: "POST", handler: revenueCatWebhook });
http.route({ path: "/ai/chat", method: "POST", handler: chatStream });

export default http;
