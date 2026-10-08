import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { NotFound } from "./NotFound";

declare global {
  interface Window {
    /** Set once hydrated; the boot script in index.html drops the "js" class (and its hidden-until-revealed styles) if this never happens. */
    __nsReady?: boolean;
  }
}

const root = document.getElementById("root");
if (root) {
  // As a transition, hydration yields to the browser instead of one long main-thread task.
  startTransition(() => {
    hydrateRoot(root, root.dataset.page === "notFound" ? <NotFound /> : <App />);
  });
  window.__nsReady = true;
}
