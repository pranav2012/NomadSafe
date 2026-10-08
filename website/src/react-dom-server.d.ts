// @types/react-dom is left out on purpose: adding it changes peer resolutions for the root app's lockfile entries.
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToString(node: ReactNode): string;
  export function renderToStaticMarkup(node: ReactNode): string;
}
