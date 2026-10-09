import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton, AuraCard, AuraSkeleton, AuraSkeletonGroup, Icon, PressableScale, showToast, useAura } from "@/atoms";
import { auraHitSlop, auraSignal } from "@/constants/aura";
import { registerGroupPush } from "@/features/sync";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { api, useMutation, useQuery } from "@/modules/backend";

const CLOSE_SIZE = 38;

/** Circle invite link landing: "Join Pranav's circle?" and, on Join, puts both people in each other's circle. */
export default function CircleInviteScreen() {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, deferred } = useLocalSearchParams<{ code: string; deferred?: string }>();
  const preview = useQuery(api.sharing.previewCircleInvite, code ? { code } : "skip");
  const join = useMutation(api.sharing.joinCircleInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerName = preview?.status === "ok" ? preview.ownerName.split(" ")[0] : "";

  const openCircle = () => router.replace("/circle");

  const handleJoin = async () => {
    if (!code || busy || preview?.status !== "ok") return;
    setBusy(true);
    setError(null);
    try {
      await join({ code });
      track("circle_invite_joined", { deferred: deferred === "1", already_connected: preview.connected });
      // Joining means getting their SOS alerts, which arrive as push notifications.
      void registerGroupPush(true);
      showToast(ownerName ? t("circle.joinDone", { name: ownerName }) : t("circle.joinDoneNoName"));
      openCircle();
    } catch {
      setError(t("circle.joinFailed"));
      setBusy(false);
    }
  };

  const message = (title: string, body: string) => (
    <AuraCard style={styles.card}>
      <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
      <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{body}</Text>
    </AuraCard>
  );

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("circle.joinTitle")}</Text>
          <PressableScale onPress={() => router.back()} hitSlop={auraHitSlop(CLOSE_SIZE)} accessibilityRole="button" accessibilityLabel={t("common.close")} style={[styles.close, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        {preview === undefined ? (
          <AuraSkeletonGroup>
            <AuraCard style={styles.card}>
              <AuraSkeleton width="65%" height={24} radius={8} />
              <AuraSkeleton width="90%" height={13} style={styles.skeletonLine} />
              <AuraSkeleton width="70%" height={13} style={styles.skeletonLine} />
            </AuraCard>
          </AuraSkeletonGroup>
        ) : preview.status === "not_found" ? (
          message(t("circle.joinNotFoundTitle"), t("circle.joinNotFoundBody"))
        ) : preview.status === "signed_out" ? (
          message(t("circle.joinTitle"), t("circle.joinSignedOut"))
        ) : preview.status === "own" ? (
          <>
            {message(t("circle.joinOwnTitle"), t("circle.joinOwnBody"))}
            <AuraButton label={t("circle.joinOpenCircle")} onPress={openCircle} style={styles.section} />
          </>
        ) : preview.connected ? (
          <>
            {message(
              ownerName ? t("circle.joinConnectedTitle", { name: ownerName }) : t("circle.joinConnectedTitleNoName"),
              t("circle.joinConnectedBody"),
            )}
            <AuraButton label={t("circle.joinOpenCircle")} onPress={openCircle} style={styles.section} />
          </>
        ) : (
          <>
            <AuraCard style={styles.card}>
              <Text numberOfLines={2} style={[styles.heading, { color: c.text, fontFamily: f.semibold }]}>
                {ownerName ? t("circle.joinHeading", { name: ownerName }) : t("circle.joinHeadingNoName")}
              </Text>
              <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("circle.joinBody")}</Text>
            </AuraCard>
            {error ? <Text style={[styles.error, { fontFamily: f.medium }]}>{error}</Text> : null}
            <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("circle.joinPrivacy")}</Text>
            <AuraButton label={t("circle.joinButton")} onPress={handleJoin} loading={busy} style={styles.section} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  title: { flex: 1, fontSize: 30, letterSpacing: -0.9 },
  close: { width: CLOSE_SIZE, height: CLOSE_SIZE, borderRadius: CLOSE_SIZE / 2, alignItems: "center", justifyContent: "center" },
  skeletonLine: { marginTop: 4 },
  card: { gap: 6 },
  heading: { fontSize: 22, letterSpacing: -0.4 },
  cardTitle: { fontSize: 17 },
  body: { fontSize: 14.5, lineHeight: 21 },
  section: { marginTop: 18 },
  error: { color: auraSignal.danger, fontSize: 13.5, marginTop: 10 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 14 },
});
