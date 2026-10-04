import { backendSiteUrl } from "@/modules/backend";

const siteUrl = backendSiteUrl ?? "";

export const LEGAL_URLS = {
  privacy: `${siteUrl}/privacy`,
  deleteAccount: `${siteUrl}/delete-account`,
  appleEula: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
} as const;

/** Web landing page for a shared-trip invite; it opens the app on the join screen. */
export function inviteUrl(code: string) {
  return `${siteUrl}/join/${code}`;
}
