import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { backendSiteUrl } from "@/modules/backend";

const siteUrl = backendSiteUrl ?? "";

export const LEGAL_URLS = {
  privacy: `${siteUrl}/privacy`,
  deleteAccount: `${siteUrl}/delete-account`,
  appleEula: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/",
} as const;

/** Opens a legal page in the in-app browser, falling back to the system browser. */
export function openLegalPage(url: string) {
  WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  }).catch(() => Linking.openURL(url).catch(() => {}));
}

/** Web landing page for a shared-trip invite; it opens the app on the join screen. */
export function inviteUrl(code: string) {
  return `${siteUrl}/join/${code}`;
}
