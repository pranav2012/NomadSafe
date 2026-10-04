/** Public API of the backend module: the Convex client, generated API, React hooks and the Better Auth client. */
export { ConvexError } from "convex/values";
export { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
export { api } from "@convex/_generated/api";
export type { Id } from "@convex/_generated/dataModel";
export { authClient } from "./authClient";
export { BackendProvider } from "./BackendProvider";
export { backendSiteUrl, convex, createBackendHttpClient } from "./client";
export { clearConvexJwt, getConvexJwt } from "./jwt";
