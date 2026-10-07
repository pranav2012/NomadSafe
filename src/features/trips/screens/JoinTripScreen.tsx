import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, useMutation, useQuery } from "@/modules/backend";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton, AuraCard, AuraChip, AuraField, AuraSkeleton, AuraSkeletonGroup, Icon, PressableScale, useAura } from "@/atoms";
import { auraHitSlop, auraSignal } from "@/constants/aura";
import { useAuthStore } from "@/features/auth/store/authStore";
import { registerGroupPush } from "@/features/sync";
import { useMoneyViewStore } from "@/features/expenses/store/moneyViewStore";
import { isPlanned, isTrip, selectShareables, useTripsStore, type Shareable } from "@/features/trips/store/tripsStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { track, PrivateView } from "@/modules/analytics";
import { fromDateKey } from "@/features/trips/utils/dates";
import { useLocalization } from "@/localization";

const NEW_MEMBER = "__new__";
const ARRIVAL_TIMEOUT_MS = 8000;
const CLOSE_SIZE = 38;

/** Waits for the joined trip, group or planned trip to arrive through live sync; a trip becomes the active trip. */
function openWhenSynced(serverTripId: string): Promise<Shareable | null> {
  const select = () => selectShareables(useTripsStore.getState()).find((item) => item.shared?.groupId === serverTripId);
  return new Promise((resolve) => {
    const activate = () => {
      const item = select();
      if (!item) return null;
      if (!isPlanned(item) && isTrip(item)) useTripsStore.getState().setActiveTrip(item.id);
      return item;
    };
    const ready = activate();
    if (ready) return resolve(ready);
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, ARRIVAL_TIMEOUT_MS);
    const unsubscribe = useTripsStore.subscribe(() => {
      const item = activate();
      if (!item) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(item);
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
  const preview = useQuery(api.groups.previewInvite, code ? { code } : "skip");
  const join = useMutation(api.groups.joinGroup);
  const userName = useAuthStore((s) => s.user?.name?.split(" ")[0] ?? "");
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState(userName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = choice ?? (preview?.unclaimed.length ? null : NEW_MEMBER);
  const k = (key: string) => (preview?.kind === "group" ? `groupShare.${key}` : `groupTrip.${key}`);

  // A joined planned trip opens on its ideas; a group on its money; a trip on Home.
  const finish = async (tripId: string) => {
    const joined = await openWhenSynced(tripId);
    const group = joined && !isPlanned(joined) && !isTrip(joined);
    if (group) useMoneyViewStore.getState().select(joined.id);
    router.dismissAll();
    router.replace(group ? "/(tabs)/expenses" : "/(tabs)");
    if (joined && isPlanned(joined)) useSavedSheetStore.getState().show(joined.id, "ideas", "join");
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
      const { groupId } = await join({
        code,
        claimMemberId: selected === NEW_MEMBER ? undefined : selected,
        name: name.trim(),
      });
      track("trip_joined", { deferred: deferred === "1", claimed_member: selected !== NEW_MEMBER });
      void registerGroupPush(true);
      await finish(groupId);
    } catch {
      setError(t("groupTrip.actionFailed"));
      setBusy(false);
    }
  };

  const dates =
    preview?.kind === "planned"
      ? `${t("planned.badge")} · ${preview.month ? t("planned.roughMonth", { month: formatDate(fromDateKey(`${preview.month}-01`), { month: "long", year: "numeric" }) }) : t("planned.noDates")}`
      : preview?.startDate
        ? `${formatDate(fromDateKey(preview.startDate), { month: "short", day: "numeric" })} — ${formatDate(fromDateKey(preview.endDate), { month: "short", day: "numeric", year: "numeric" })}`
        : "";

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t(k("joinTitle"))}</Text>
          <PressableScale onPress={() => router.back()} hitSlop={auraHitSlop(CLOSE_SIZE)} accessibilityRole="button" accessibilityLabel={t("common.close")} style={[styles.close, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        {preview === undefined ? (
          <AuraSkeletonGroup>
            <AuraCard style={styles.card}>
              <AuraSkeleton width="65%" height={24} radius={8} />
              <AuraSkeleton width="45%" height={13} style={styles.skeletonLine} />
              <AuraSkeleton width="70%" height={13} style={styles.skeletonLine} />
            </AuraCard>
          </AuraSkeletonGroup>
        ) : preview === null ? (
          <AuraCard style={styles.card}>
            <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>{t("groupTrip.joinNotFoundTitle")}</Text>
            <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.joinNotFoundBody")}</Text>
          </AuraCard>
        ) : (
          <>
            <AuraCard style={styles.card}>
              <Text numberOfLines={2} style={[styles.tripName, { color: c.text, fontFamily: f.semibold }]}>
                {preview.name}
              </Text>
              {dates ? <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{dates}</Text> : null}
              <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>
                {t("groupTrip.joinInvitedBy", { name: preview.ownerName })} · {t("groupTrip.joinPeople", { count: preview.memberCount })}
              </Text>
            </AuraCard>

            {preview.alreadyMember ? (
              <>
                <Text style={[styles.body, styles.section, { color: c.textSoft, fontFamily: f.regular }]}>{t(k("joinAlready"))}</Text>
                <AuraButton label={t(k("openTrip"))} onPress={() => void finish(preview.groupId)} style={styles.section} />
              </>
            ) : (
              <>
                {preview.unclaimed.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>{t("groupTrip.joinWhoAreYou")}</Text>
                    <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{t("groupTrip.joinWhoAreYouBody")}</Text>
                    <PrivateView style={styles.chips} accessibilityRole="radiogroup">
                      {preview.unclaimed.map((member) => (
                        <AuraChip key={member.memberId} label={member.name} icon="users" selected={selected === member.memberId} onPress={() => setChoice(member.memberId)} />
                      ))}
                      <AuraChip label={t("groupTrip.joinAsNew")} icon="plus" selected={selected === NEW_MEMBER} onPress={() => setChoice(NEW_MEMBER)} />
                    </PrivateView>
                  </View>
                ) : null}
                {selected === NEW_MEMBER ? (
                  <AuraField
                    label={t(k("joinNameLabel"))}
                    value={name}
                    onChangeText={setName}
                    placeholder={t("groupTrip.joinNamePlaceholder")}
                    autoCapitalize="words"
                    maxLength={60}
                  />
                ) : null}
                {error ? <Text style={[styles.error, { fontFamily: f.medium }]}>{error}</Text> : null}
                <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t(k("joinPrivacy"))}</Text>
                <AuraButton label={t(k("joinButton"))} onPress={handleJoin} loading={busy} disabled={!selected} style={styles.section} />
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
  close: { width: CLOSE_SIZE, height: CLOSE_SIZE, borderRadius: CLOSE_SIZE / 2, alignItems: "center", justifyContent: "center" },
  skeletonLine: { marginTop: 4 },
  card: { gap: 6 },
  tripName: { fontSize: 22, letterSpacing: -0.4 },
  cardTitle: { fontSize: 17 },
  body: { fontSize: 14.5, lineHeight: 21 },
  section: { marginTop: 18, gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  error: { color: auraSignal.danger, fontSize: 13.5, marginTop: 10 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 14 },
});
