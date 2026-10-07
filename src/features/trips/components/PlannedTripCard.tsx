import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AuraButton, AuraOptionSheet, Icon, PressableScale, showAlert, showToast, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { api, useMutation, type Id } from "@/modules/backend";
import { ideasOf, useEventsStore, useSavedSheetStore } from "@/features/itinerary";
import { IdeaStrip } from "@/features/itinerary/components/IdeaStrip";
import { isArchivedGroup, useTripsStore, type PlannedTrip } from "@/features/trips/store/tripsStore";

/** "Sometime in March" for a planned trip's month, else "No dates yet". */
export function plannedWhen(planned: PlannedTrip, locale: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!planned.month) return t("planned.noDates");
  const date = new Date(Number(planned.month.slice(0, 4)), Number(planned.month.slice(5, 7)) - 1, 1);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return t("planned.roughMonth", { month: new Intl.DateTimeFormat(locale, sameYear ? { month: "long" } : { month: "long", year: "numeric" }).format(date) });
}

/**
 * A planned trip as a dashed pass outline: tap for its ideas, Confirm to set dates (the owner, when
 * shared), Invite, and ⋯ to discard it (for everyone, if you own a shared one) or leave it.
 */
export function PlannedTripCard({ planned, compact = false, onInvite }: { planned: PlannedTrip; compact?: boolean; onInvite?: (id: string) => void }) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const router = useRouter();
  const events = useEventsStore((state) => state.events);
  const ideas = ideasOf(events.filter((event) => event.tripId === planned.id));
  const ideaCount = ideas.length;
  const showSaved = useSavedSheetStore((state) => state.show);
  const deleteShared = useMutation(api.groups.deleteSharedGroup);
  const leaveShared = useMutation(api.groups.leaveGroup);
  const shared = planned.shared;
  const isMember = shared?.role === "member";
  const ownerName = shared?.members.find((member) => member.role === "owner")?.name ?? "";
  const serverId = shared?.groupId as Id<"sharedGroups"> | undefined;
  const [moving, setMoving] = useState(false);
  const trips = useTripsStore((state) => state.trips);
  const plannedTrips = useTripsStore((state) => state.plannedTrips);
  const targets = [
    ...trips.filter((trip) => !isArchivedGroup(trip)).map((trip) => ({ value: trip.id, label: trip.name })),
    ...plannedTrips.filter((other) => other.id !== planned.id).map((other) => ({ value: other.id, label: other.name, detail: t("planned.badge") })),
  ];

  const discard = async (moveTo: string | null) => {
    const ideas = ideasOf(useEventsStore.getState().events.filter((event) => event.tripId === planned.id));
    if (moveTo) {
      ideas.forEach((idea) => useEventsStore.getState().updateEvent(idea.id, { tripId: moveTo }));
      const target = targets.find((item) => item.value === moveTo);
      showToast(t("planned.movedToast", { count: ideas.length, name: target?.label ?? "" }));
    }
    // A shared one is removed on the server, and live sync then drops it (and what's left on it) here.
    if (serverId) {
      try {
        await deleteShared({ groupId: serverId });
      } catch {
        showAlert(t("groupTrip.actionFailed"));
        return;
      }
    } else {
      useEventsStore.getState().removeByTripId(planned.id);
      useTripsStore.getState().deletePlannedTrip(planned.id);
    }
    track("planned_trip", { action: "discarded", ideas: ideas.length });
  };

  const askLeave = () =>
    showAlert(t("planned.leaveTitle", { name: planned.name }), t("planned.leaveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("planned.leave"),
        style: "destructive",
        onPress: () => {
          if (serverId) leaveShared({ groupId: serverId }).catch(() => showAlert(t("groupTrip.actionFailed")));
        },
      },
    ]);

  const askDiscard = () => {
    if (isMember) return askLeave();
    const title = t("planned.discardTitle", { name: planned.name });
    const forEveryone = shared && planned.companions.length > 0 ? ` ${t("planned.discardForEveryone")}` : "";
    if (ideaCount === 0) {
      showAlert(title, `${t("planned.discardEmptyBody")}${forEveryone}`, [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("planned.discard"), style: "destructive", onPress: () => void discard(null) },
      ]);
      return;
    }
    showAlert(title, `${t("planned.discardBody", { count: ideaCount })}${forEveryone}`, [
      { text: t("common.cancel"), style: "cancel" },
      ...(targets.length > 0 ? [{ text: t("planned.moveIdeas"), onPress: () => setMoving(true) }] : []),
      { text: t("planned.discardWithIdeas"), style: "destructive" as const, onPress: () => void discard(null) },
    ]);
  };

  return (
    <PressableScale
      onPress={() => showSaved(planned.id, "ideas", "prep")}
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${planned.name}, ${t("planned.badge")}`}
      style={[styles.card, compact && styles.compact, { borderColor: c.textMuted }]}
    >
      <View style={styles.head}>
        <View style={[styles.badge, { borderColor: c.textMuted }]}>
          <Text style={[styles.badgeText, { color: c.textSoft, fontFamily: f.semibold }]}>{t("planned.badge")}</Text>
        </View>
        <PressableScale onPress={askDiscard} hitSlop={10} accessibilityRole="button" accessibilityLabel={isMember ? t("planned.leave") : t("planned.discard")}>
          <Icon name="more" size={18} color={c.textMuted} />
        </PressableScale>
      </View>
      <Text numberOfLines={1} style={[styles.name, compact && styles.nameCompact, { color: c.text, fontFamily: f.semibold }]}>
        {planned.name}
      </Text>
      <Text numberOfLines={1} style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]}>
        {[
          plannedWhen(planned, locale, t),
          ideaCount > 0 ? t("planned.ideas", { count: ideaCount }) : null,
          shared && planned.companions.length > 0 ? t("planned.withPeople", { names: planned.companions.join(", ") }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {ideaCount > 0 && !compact ? (
        <View style={styles.strip}>
          <IdeaStrip tripId={planned.id} ideas={ideas} size="sm" inset={16} />
        </View>
      ) : null}
      {compact ? null : (
        <>
          {isMember ? (
            <Text style={[styles.waiting, { color: c.textSoft, fontFamily: f.medium }]}>{t("planned.waiting", { name: ownerName })}</Text>
          ) : null}
          <View style={styles.actions}>
            {isMember ? null : (
              <AuraButton label={t("planned.confirm")} size="md" onPress={() => router.push({ pathname: "/plan-trip", params: { confirm: planned.id } })} />
            )}
            {onInvite ? <AuraButton label={t("planned.invite")} icon="users" variant="secondary" size="md" onPress={() => onInvite(planned.id)} /> : null}
          </View>
        </>
      )}
      <AuraOptionSheet
        visible={moving}
        onClose={() => setMoving(false)}
        title={t("planned.moveTitle")}
        options={targets}
        selected={null}
        onSelect={(value) => {
          setMoving(false);
          if (value) void discard(value);
        }}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1.4, borderStyle: "dashed", padding: 16, gap: 6 },
  compact: { width: 210, padding: 14 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  badge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  name: { fontSize: 24, letterSpacing: -0.6 },
  nameCompact: { fontSize: 19 },
  meta: { fontSize: 13 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  strip: { marginTop: 10 },
  waiting: { fontSize: 13.5, marginTop: 6 },
});
