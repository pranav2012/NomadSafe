// Minimal types for the two react-dom entry points the site uses, instead of pulling in @types/react-dom.
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToString(node: ReactNode): string;
  export function renderToStaticMarkup(node: ReactNode): string;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export function hydrateRoot(container: Element, node: ReactNode): { unmount(): void };
}
