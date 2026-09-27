const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL ?? "";

export const LEGAL_URLS = {
  privacy: `${siteUrl}/privacy`,
  deleteAccount: `${siteUrl}/delete-account`,
} as const;
