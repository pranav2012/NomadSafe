import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { deleteAccountPage, privacyPolicy, submitDeletionRequest } from "./legalPages";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

http.route({ path: "/privacy", method: "GET", handler: privacyPolicy });
http.route({ path: "/delete-account", method: "GET", handler: deleteAccountPage });
http.route({ path: "/delete-account", method: "POST", handler: submitDeletionRequest });

export default http;
