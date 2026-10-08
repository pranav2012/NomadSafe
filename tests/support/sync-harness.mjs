// Loads the sync engines with their native and backend dependencies replaced by in-memory fakes,
// so the real stores, ledgers and merge rules run under node:test.
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

const STUBS = {
  "@/modules/storage": `
    const h = globalThis.__syncTest;
    export const storage = {
      getString: (key) => h.storage.get(key),
      set: (key, value) => { h.storage.set(key, String(value)); },
      remove: (key) => { h.storage.delete(key); },
      delete: (key) => { h.storage.delete(key); },
      contains: (key) => h.storage.has(key),
      getAllKeys: () => [...h.storage.keys()],
      getBoolean: () => undefined,
      getNumber: () => undefined,
    };
    export const isStoragePersistent = true;
    export function flushPendingWrites() {}
    export function clearAllStorage() { h.storage.clear(); }
    export const mmkvStateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    export const secureStore = {};
    export const credentials = {};
  `,
  "@/modules/backend": `
    const h = globalThis.__syncTest;
    // api.sync.push -> { __path: "sync.push" }
    const ref = (path) => new Proxy({}, { get: (_t, key) => (key === "__path" ? path : typeof key === "symbol" ? undefined : ref(path ? path + "." + key : key)) });
    export const api = ref("");
    export const convex = {
      mutation: (fn, args) => h.convex.mutation(fn.__path, args),
      query: (fn, args) => h.convex.query(fn.__path, args),
      action: (fn, args) => h.convex.action(fn.__path, args),
      watchQuery: (fn, args) => h.convex.watchQuery(fn.__path, args),
    };
    export class ConvexError extends Error {}
    export function getBackendHttpClient() { return null; }
    export async function getConvexJwt() { return null; }
    export function clearConvexJwt() {}
    export const backendSiteUrl = "";
  `,
  "@/modules/logger": `
    export const logger = { debug() {}, info() {}, warn() {}, error() {} };
    export function scrubErrorMessage(message) { return message; }
    export function countAttributes() { return {}; }
  `,
  "@/modules/appCheck": `
    export async function getAppCheckToken() { return null; }
    export async function withAppCheck(args) { return args; }
  `,
  "react-native": `
    const h = globalThis.__syncTest;
    export const AppState = {
      currentState: "active",
      addEventListener: (_type, listener) => {
        h.appStateListeners.add(listener);
        return { remove: () => h.appStateListeners.delete(listener) };
      },
    };
    export const Platform = { OS: "android", select: (o) => o.android ?? o.default };
  `,
  "@/features/widget/syncWidgets": `export async function syncWidgets() {}`,
  "@/features/recap/services/tripPhotos": `export async function deleteAllTripPhotos() {}`,
  "@/features/itinerary/services/tickets": `export async function deleteAllTickets() {}`,
  "@/features/itinerary/services/ideaThumbs": `export async function deleteAllIdeaThumbs() {}`,
  "@/features/ai/store/chatStore": `
    const h = globalThis.__syncTest;
    export const useChatStore = { getState: () => ({ removeConversation: (id) => h.removedChats.push(id) }) };
  `,
};

// Any other package (Expo, native SDKs) becomes an inert object; only zustand runs for real.
const INERT = `
  const make = () => new Proxy(function () {}, {
    get: (_t, key) => (key === "__esModule" ? false : key === Symbol.toPrimitive ? () => "" : make()),
    apply: () => make(),
    construct: () => make(),
  });
  module.exports = make();
`;

const stubPlugin = {
  name: "sync-test-stubs",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.path in STUBS) return { path: args.path, namespace: "stub" };
      if (args.path.startsWith(".") || args.path.startsWith("/") || args.path.startsWith("@/") || args.path.startsWith("@convex/")) return undefined;
      if (args.path === "zustand" || args.path.startsWith("zustand/")) return undefined;
      return { path: args.path, namespace: "inert" };
    });
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
    build.onLoad({ filter: /.*/, namespace: "inert" }, () => ({ contents: INERT, loader: "js" }));
  },
};

/** Bundles `source` (an ES module importing from the app) with the fakes above, once per test file. */
export async function bundleWithFakes(source) {
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    alias: { "@": "./src", "@convex": "./convex" },
    define: { __DEV__: "false" },
    plugins: [stubPlugin],
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

/** Runs a bundle with fresh stores and engine state; the returned `harness` is what the fakes read. */
export function instantiate(code) {
  const harness = {
    storage: new Map(),
    appStateListeners: new Set(),
    removedChats: [],
    convex: {
      mutation: async () => ({}),
      query: async () => ({ page: [], isDone: true, continueCursor: "" }),
      action: async () => null,
      watchQuery: () => ({ localQueryResult: () => undefined, onUpdate: () => () => {} }),
    },
  };
  globalThis.__syncTest = harness;
  const module = { exports: {} };
  new Function("exports", "module", "require", code)(module.exports, module, require);
  return { mod: module.exports, harness };
}

/** Lets queued promise chains (fake backend calls resolve immediately) run to completion. */
export async function settle(turns = 30) {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Fires the AppState "active" listeners, which start a sync without the push debounce. */
export function becomeActive(harness) {
  for (const listener of harness.appStateListeners) listener("active");
}
