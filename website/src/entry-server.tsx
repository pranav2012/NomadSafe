import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { App } from "./App";
import { Head } from "./Head";
import { NotFound } from "./NotFound";

export type Page = "home" | "notFound";

export function renderPage(page: Page) {
  return {
    head: renderToStaticMarkup(<Head page={page} />),
    html: renderToString(page === "home" ? <App /> : <NotFound />),
  };
}
