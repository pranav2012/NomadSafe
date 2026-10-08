import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ssrEntry = new URL("../dist-ssr/entry-server.js", import.meta.url);

const { renderPage } = await import(ssrEntry.href);
const template = await readFile(`${root}dist/index.html`, "utf8");

const pages = { home: "index.html", notFound: "404.html" };
for (const [page, file] of Object.entries(pages)) {
  const { head, html } = renderPage(page);
  await writeFile(`${root}dist/${file}`, template.replace("<!--head-->", head).replace("<!--app-->", html));
  console.log(`prerendered dist/${file}`);
}

await rm(`${root}dist-ssr`, { recursive: true, force: true });
