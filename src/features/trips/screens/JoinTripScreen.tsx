import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, useMutation, useQuery } from "@/modules/backend";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton, AuraCard, AuraChip, AuraField, Icon, PressableScale, useAura } from "@/atoms";
import { useAuthStore } from "@/features/auth/store/authStore";
import { registerTripPush } from "@/features/sync";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { track } from "@/modules/analytics";
import { fromDateKey } from "@/features/trips/utils/dates";
import { useLocalization } from "@/localization";

const NEW_MEMBER = "__new__";
const ARRIVAL_TIMEOUT_MS = 8000;

/** Waits for the joined trip to arrive through live sync, then makes it the active trip. */
function openWhenSynced(serverTripId: string): Promise<boolean> {
  const select = () => useTripsStore.getState().trips.find((trip) => trip.shared?.tripId === serverTripId);
  return new Promise((resolve) => {
    const activate = () => {
      const trip = select();
      if (!trip) return false;
      useTripsStore.getState().setActiveTrip(trip.id);
      return true;
    };
    if (activate()) return resolve(true);
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, ARRIVAL_TIMEOUT_MS);
    const unsubscribe = useTripsStore.subscribe(() => {
      if (!activate()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/** Invite link / code landing: shows the trip and lets the user join, optionally as an existing companion. */
export default function JoinTripScreen() {
  const { c, f } = useAura();
  const { t, formatDate } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, deferred } = useLocalSearchParams<{ code: string; deferred?: string }>();
  const preview = useQuery(api.groupTrips.previewInvite, code ? { code } : "skip");
  const join = useMutation(api.groupTrips.joinTrip);
  const userName = useAuthStore((s) => s.user?.name?.split(" ")[0] ?? "");
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState(userName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = choice ?? (preview?.unclaimed.length ? null : NEW_MEMBER);

  const finish = async (tripId: string) => {
    await openWhenSynced(tripId);
    router.dismissAll();
    router.replace("/(tabs)");
  };

  const handleJoin = async () => {
    if (!preview || !code || busy || !selected) return;
    if (selected === NEW_MEMBER && !name.trim()) {
      setError(t("groupTrip.joinNameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { tripId } = await join({
        code,
        claimMemberId: selected === NEW_MEMBER ? undefined : selected,
        name: name.trim(),
      });
      track("trip_joined", { deferred: deferred === "1", claimed_member: selected !== NEW_MEMBER });
      void registerTripPush(true);
      await finish(tripId);
    } catch {
      setError(t("groupTrip.actionFailed"));
      setBusy(false);
    }
  };

  const dates = preview?.startDate
    ? `${formatDate(fromDateKey(preview.startDate), { month: "short", day: "numeric" })} — ${formatDate(fromDateKey(preview.endDate), { month: "short", day: "numeric", year: "numeric" })}`
    : "";

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("groupTrip.joinTitle")}</Text>
          <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.close")} style={[styles.close, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        {preview === undefined ? (
          <ActivityIndicator color={c.textMuted} style={styles.loading} />
        ) : preview === null ? (
          <AuraCard style={styles.card}>
            <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>{t("groupTrip.joinNotFoundTitle")}</Text>
            <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.joinNotFoundBody")}</Text>
          </AuraCard>
        ) : (
          <>
            <AuraCard style={styles.card}>
              <Text style={[styles.tripName, { color: c.text, fontFamily: f.semibold }]}>{preview.name}</Text>
              {dates ? <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{dates}</Text> : null}
              <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>
                {t("groupTrip.joinInvitedBy", { name: preview.ownerName })} · {t("groupTrip.joinPeople", { count: preview.memberCount })}
              </Text>
            </AuraCard>

            {preview.alreadyMember ? (
              <>
                <Text style={[styles.body, styles.section, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.joinAlready")}</Text>
                <AuraButton label={t("groupTrip.openTrip")} onPress={() => void finish(preview.tripId)} style={styles.section} />
              </>
            ) : (
              <>
                {preview.unclaimed.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>{t("groupTrip.joinWhoAreYou")}</Text>
                    <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.joinWhoAreYouBody")}</Text>
                    <View style={styles.chips} accessibilityRole="radiogroup">
                      {preview.unclaimed.map((member) => (
                        <AuraChip key={member.memberId} label={member.name} icon="users" selected={selected === member.memberId} onPress={() => setChoice(member.memberId)} />
                      ))}
                      <AuraChip label={t("groupTrip.joinAsNew")} icon="plus" selected={selected === NEW_MEMBER} onPress={() => setChoice(NEW_MEMBER)} />
                    </View>
                  </View>
                ) : null}
                {selected === NEW_MEMBER ? (
                  <AuraField
                    label={t("groupTrip.joinNameLabel")}
                    value={name}
                    onChangeText={setName}
                    placeholder={t("groupTrip.joinNamePlaceholder")}
                    autoCapitalize="words"
                    maxLength={60}
                  />
                ) : null}
                {error ? <Text style={[styles.error, { fontFamily: f.medium }]}>{error}</Text> : null}
                <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("groupTrip.joinPrivacy")}</Text>
                <AuraButton label={t("groupTrip.joinButton")} onPress={handleJoin} loading={busy} disabled={!selected} style={styles.section} />
              </>
            )}
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
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  loading: { marginTop: 40 },
  card: { gap: 6 },
  tripName: { fontSize: 22, letterSpacing: -0.4 },
  cardTitle: { fontSize: 17 },
  body: { fontSize: 14.5, lineHeight: 21 },
  section: { marginTop: 18, gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  error: { color: "#FF4D5E", fontSize: 13.5, marginTop: 10 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 14 },
});
