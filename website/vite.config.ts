import { readFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";

// In dev, render each page on the server the same way scripts/prerender.mjs does at build time, so no client JS is needed.
function serverRender(): Plugin {
  return {
    name: "nomadsafe-server-render",
    apply: "serve",
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          const url = req.originalUrl ?? "/";
          if (req.method !== "GET" || !(req.headers.accept ?? "").includes("text/html")) return next();
          try {
            const template = await server.transformIndexHtml(url, await readFile("index.html", "utf8"));
            const { renderPage } = await server.ssrLoadModule("/src/entry-server.tsx");
            const page = url === "/" || url.startsWith("/?") ? "home" : "notFound";
            const { head, html } = renderPage(page);
            res.statusCode = page === "home" ? 200 : 404;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(template.replace("<!--head-->", head).replace("<!--app-->", html));
          } catch (error) {
            server.ssrFixStacktrace(error as Error);
            next(error);
          }
        });
      };
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  appType: "custom",
  plugins: [serverRender()],
  build: {
    copyPublicDir: !isSsrBuild,
    emptyOutDir: true,
  },
}));
