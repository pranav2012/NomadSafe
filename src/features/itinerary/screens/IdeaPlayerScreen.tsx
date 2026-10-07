import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { AuraButton, Icon, PressableScale } from "@/atoms";
import { auraDark, auraFonts as f } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { backendSiteUrl } from "@/modules/backend";
import { keepIdeaThumb } from "@/features/itinerary/services/ideaThumbs";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useIdeaThumbsStore } from "@/features/itinerary/store/ideaThumbsStore";
import { embedFor } from "@/features/itinerary/utils/sharedLinks";

const CAPTURE_DELAY_MS = 2500;
const PLAYER_HOSTS = /(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net|tiktok\.com|tiktokcdn\.com|tiktokv\.com|youtube-nocookie\.com|youtube\.com|ytimg\.com|googlevideo\.com|google\.com|gstatic\.com|doubleclick\.net)$/;
const PROVIDER_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", web: "" } as const;

/** YouTube's player refuses to play without a web page (and origin) around it. */
function youtubePage(id: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`;
}

/** Plays a saved reel or video through the site's embed; for Instagram, a frame becomes the card image. */
export default function IdeaPlayerScreen() {
  const { t } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const event = useEventsStore((state) => state.events.find((item) => item.id === eventId));
  const hasThumb = useIdeaThumbsStore((state) => Boolean(eventId && state.thumbs[eventId]));
  const [loading, setLoading] = useState(true);
  const frame = useRef<View>(null);
  const captured = useRef(false);
  const link = event?.link;
  const embed = link ? embedFor(link) : null;

  useEffect(() => {
    if (link) track("idea_played", { provider: link.provider });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLoaded = () => {
    setLoading(false);
    if (!eventId || !link || link.thumbnail || hasThumb || captured.current) return;
    captured.current = true;
    setTimeout(() => {
      if (!frame.current) return;
      captureRef(frame, { format: "jpg", quality: 0.7, width: 360, result: "tmpfile" })
        .then((uri) => keepIdeaThumb(eventId, uri))
        .catch(() => {});
    }, CAPTURE_DELAY_MS);
  };

  const openOutside = () => {
    if (link) void Linking.openURL(link.url).catch(() => {});
  };

  // Only the embed itself loads here; tapping through to the full site or app opens it outside.
  const allowNavigation = (request: WebViewNavigation & { isTopFrame?: boolean }) => {
    if (request.isTopFrame === false || request.url.startsWith("about:") || request.url.startsWith("data:")) return true;
    try {
      const host = new URL(request.url).hostname;
      if (PLAYER_HOSTS.test(host) && (request.url === (embed?.kind === "page" ? embed.uri : "") || request.navigationType !== "click")) return true;
      if (backendSiteUrl && host === new URL(backendSiteUrl).hostname) return true;
    } catch {}
    void Linking.openURL(request.url).catch(() => {});
    return false;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.round}>
          <Icon name="x" size={16} color={auraDark.text} />
        </PressableScale>
        <Text numberOfLines={1} style={styles.title}>
          {event?.title ?? ""}
        </Text>
        {link && link.provider !== "web" ? (
          <AuraButton label={t("ideas.openIn", { app: PROVIDER_NAME[link.provider] })} size="md" variant="secondary" onPress={openOutside} />
        ) : null}
      </View>
      <PrivateView style={styles.flex}>
        <View ref={frame} collapsable={false} style={styles.flex}>
          {embed ? (
            <WebView
              source={embed.kind === "page" ? { uri: embed.uri } : { html: youtubePage(embed.id), baseUrl: backendSiteUrl ?? "https://localhost" }}
              style={styles.web}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={allowNavigation}
              onLoadEnd={onLoaded}
              onError={() => setLoading(false)}
            />
          ) : (
            <View style={styles.missing}>
              <Text style={styles.missingText}>{t("ideas.cantPlay")}</Text>
              {link ? <AuraButton label={t("ideas.openLink")} size="md" onPress={openOutside} /> : null}
            </View>
          )}
          {loading && embed ? <ActivityIndicator style={StyleSheet.absoluteFill} color={auraDark.textSoft} /> : null}
        </View>
      </PrivateView>
      <View style={{ height: insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: auraDark.surfaceStrong },
  title: { flex: 1, color: auraDark.text, fontFamily: f.semibold, fontSize: 15 },
  web: { flex: 1, backgroundColor: "#000" },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  missingText: { color: auraDark.textSoft, fontFamily: f.regular, fontSize: 15, textAlign: "center" },
});
