import { SITE_URL } from "./site";

const TITLE = "NomadSafe: your travel companion for memories, planning, money and safety";
const DESCRIPTION =
  "NomadSafe keeps the whole trip in one calm app: a replay of your trip with your best photos, a day-by-day plan, fair splits with friends, and SOS and live location for the people you choose. Coming soon to Android and iPhone.";
const SHARE_TITLE = "NomadSafe: memories, planning, money and safety in one travel app";
const SHARE_DESCRIPTION = "Relive your trips, plan your days, split the money and stay reachable. Coming soon to Android and iPhone.";

export function Head({ page }: { page: "home" | "notFound" }) {
  const icons = (
    <>
      <meta name="theme-color" content="#0B0D12" />
      <meta name="color-scheme" content="dark" />
      <link rel="icon" href="/img/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/img/favicon-48.png" type="image/png" sizes="48x48" />
      <link rel="apple-touch-icon" href="/img/apple-touch-icon.png" />
    </>
  );

  if (page === "notFound") {
    return (
      <>
        <title>Page not found · NomadSafe</title>
        <meta name="robots" content="noindex" />
        {icons}
      </>
    );
  }

  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href={`${SITE_URL}/`} />
      {icons}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="NomadSafe" />
      <meta property="og:url" content={`${SITE_URL}/`} />
      <meta property="og:title" content={SHARE_TITLE} />
      <meta property="og:description" content={SHARE_DESCRIPTION} />
      <meta property="og:image" content={`${SITE_URL}/img/og.png`} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta
        property="og:image:alt"
        content="The NomadSafe aurora logo next to the words: Memories, planning, money and safety, in one calm travel companion."
      />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={SHARE_TITLE} />
      <meta name="twitter:description" content={SHARE_DESCRIPTION} />
      <meta name="twitter:image" content={`${SITE_URL}/img/og.png`} />
    </>
  );
}
