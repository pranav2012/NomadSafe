import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ssrEntry = new URL("../dist-ssr/entry-server.js", import.meta.url);

const { renderPage } = await import(ssrEntry.href);
const template = await readFile(`${root}dist/index.html`, "utf8");

const pages = { home: "index.html", notFound: "404.html" };
for (const [page, file] of Object.entries(pages)) {
  const { head, html } = renderPage(page);
  const out = template.replace("<!--head-->", head).replace("<!--app-->", html).replace("<!--page-->", page);
  await writeFile(`${root}dist/${file}`, out);
  console.log(`prerendered dist/${file}`);
}

// The CSP allows inline scripts only by hash: hash the boot script(s) and fill them into _headers.
const inline = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);
const headersPath = `${root}dist/_headers`;
const headers = await readFile(headersPath, "utf8");
if (!headers.includes("__INLINE_SCRIPT_HASHES__")) throw new Error("_headers is missing __INLINE_SCRIPT_HASHES__");
await writeFile(headersPath, headers.replace("__INLINE_SCRIPT_HASHES__", inline.join(" ")));
console.log(`csp: ${inline.length} inline script hash(es)`);

await rm(`${root}dist-ssr`, { recursive: true, force: true });
