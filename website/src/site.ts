export const SITE_URL = "https://nomadsafe.pranav-agarwal.com";
export const CONTACT_EMAIL = "p2012agarwal@gmail.com";

/** Store pages. null shows a "Coming soon" badge; set the URL at launch and rebuild. */
export const STORE_LINKS: { play: string | null; appStore: string | null } = {
  play: null, // "https://play.google.com/store/apps/details?id=com.pranav.nomadsafe"
  appStore: null,
};

/** Screenshot size the phone frames expect (Pixel captures). Placeholders are cropped to fit. */
export const SCREEN = { width: 1440, height: 3120 };
