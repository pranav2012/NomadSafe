import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraDateField, AuraField, AuraSegmented, AuraSheet, Icon, PressableScale, useAura } from "@/atoms";
import { track } from "@/modules/analytics";
import { attachFiles, attachPhotos } from "@/features/itinerary/services/tickets";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { SELF_ID } from "@/features/expenses/utils/split";
import { EVENT_TYPES, TRANSIT_MODES, canBeUntimed, type EventTiming, type EventType, type TransitMode } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { transitModeOf } from "@/features/itinerary/utils/transit";
import { toWallClock } from "@/features/itinerary/utils/wallClock";

export interface EventFormValues {
  type: EventType;
  title: string;
  detail: string;
  startAt: string;
  /** Check-out for a stay, arrival for a transit; undefined when not set. */
  endAt?: string;
  /** Set only for transit events. */
  transitMode?: TransitMode;
  timing?: EventTiming;
  /** Undefined means everyone. */
  people?: string[];
}

type When = "time" | EventTiming;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DETAIL_SEPARATOR = " · ";

/** Puts back the English sentinel head ("Check-out", "Departure"…) when the user kept its translated form. */
function restoreDetailHead(edited: string, original: string | undefined, localized: string): string {
  if (!original) return edited;
  const originalHead = original.split(DETAIL_SEPARATOR)[0];
  const localizedHead = localized.split(DETAIL_SEPARATOR)[0];
  if (originalHead === localizedHead) return edited;
  if (edited === localizedHead || edited.startsWith(localizedHead + DETAIL_SEPARATOR)) {
    return originalHead + edited.slice(localizedHead.length);
  }
  return edited;
}

/** Sheet to create or edit a single itinerary event; shows Delete when editing. */
export function EventForm({
  event,
  defaultStart,
  tripStart,
  companions,
  onOpenTicket,
  visible,
  onSave,
  onDelete,
  onClose,
}: {
  event: TripEvent | null;
  /** Start time for a new event (e.g. the day picked on Home); now when omitted. */
  defaultStart?: Date;
  /** Wishlist items are filed under the trip's first day. */
  tripStart: Date;
  /** Other travellers; "Who's it for" shows when there are any. */
  companions: string[];
  /** Opens a saved ticket full screen (the parent closes this sheet first). */
  onOpenTicket: (ticketId: string) => void;
  visible: boolean;
  onSave: (values: EventFormValues) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const { c, f } = useAura();

  // The parent remounts this form (via `key`) for each open, so state initializes fresh from props.
  const [type, setType] = useState<EventType>(event?.type ?? "activity");
  const [title, setTitle] = useState(event ? localizeEventTitle(event.title, t) : "");
  const [initialDetail] = useState(() => (event ? (localizeEventDetail(event.detail, t) ?? "") : ""));
  const [detail, setDetail] = useState(initialDetail);
  const [transitMode, setTransitMode] = useState<TransitMode | undefined>(() => (event ? transitModeOf(event) : undefined));
  const [when, setWhen] = useState<Date>(() => (event ? new Date(event.startAt) : (defaultStart ?? new Date())));
  const [until, setUntil] = useState<Date>(() =>
    event?.endAt ? new Date(event.endAt) : new Date((event ? new Date(event.startAt) : (defaultStart ?? new Date())).getTime() + DAY_MS),
  );
  const [pickedWhen, setWhenKind] = useState<When>(event?.timing ?? "time");
  const [people, setPeople] = useState<string[]>(event?.people ?? []);
  const allTickets = useTicketsStore((state) => state.tickets);
  const tickets = event ? allTickets.filter((ticket) => ticket.eventId === event.id) : [];
  const addTickets = async (source: "file" | "photo") => {
    if (!event) return;
    const count = source === "file" ? await attachFiles(event.id) : await attachPhotos(event.id);
    if (count > 0) track("ticket_added", { source, count });
  };
  const untimedAllowed = canBeUntimed(type);
  const whenKind: When = untimedAllowed ? pickedWhen : "time";
  const everyone = [SELF_ID, ...companions];

  const changeType = (next: EventType) => {
    if (!event && next === "note" && pickedWhen === "time") setWhenKind("anytime");
    setType(next);
  };
  // Picking every person is the same as everyone, so it's stored as "everyone".
  const togglePerson = (person: string) => {
    const next = people.includes(person) ? people.filter((p) => p !== person) : [...people, person];
    setPeople(next.length === everyone.length ? [] : next);
  };

  const savedDetail = restoreDetailHead(detail.trim(), event?.detail, initialDetail);
  // A lone check-out (from a booking email) is its own entry and has no separate end.
  const isLoneCheckOut = type === "stay" && !event?.endAt && savedDetail.split(DETAIL_SEPARATOR)[0] === "Check-out";
  // Stays always have a check-out; a transit shows its arrival only when one is known.
  const hasEnd = whenKind === "time" && ((type === "stay" && !isLoneCheckOut) || (type === "transit" && Boolean(event?.endAt)));
  const canSave = title.trim().length > 0;

  // Moving the start past the end shifts the end by the same duration, so it stays valid.
  const changeWhen = (next: Date) => {
    if (hasEnd && next.getTime() >= until.getTime()) {
      const duration = until.getTime() - when.getTime();
      setUntil(new Date(next.getTime() + (duration > 0 ? duration : type === "stay" ? DAY_MS : HOUR_MS)));
    }
    setWhen(next);
  };

  const save = () => {
    if (!canSave) return;
    const endAt = hasEnd && until.getTime() > when.getTime() ? toWallClock(until) : undefined;
    const day = new Date(when.getFullYear(), when.getMonth(), when.getDate());
    const keptWishlistAt = event?.timing === "wishlist" ? new Date(event.startAt) : tripStart;
    onSave({
      type,
      title: title.trim(),
      detail: savedDetail,
      startAt: toWallClock(whenKind === "time" ? when : whenKind === "anytime" ? day : keptWishlistAt),
      endAt,
      transitMode: type === "transit" ? transitMode : undefined,
      timing: whenKind === "time" ? undefined : whenKind,
      people: people.length > 0 ? people : undefined,
    });
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={event ? t("itinerary.form.editTitle") : t("itinerary.form.addTitle")}
      footer={
        <View style={styles.actions}>
          {event && onDelete ? (
            <AuraButton label={t("itinerary.form.delete")} icon="trash" variant="secondary" onPress={onDelete} style={styles.delete} />
          ) : null}
          <AuraButton
            label={event ? t("itinerary.form.save") : t("itinerary.form.add")}
            onPress={save}
            disabled={!canSave}
            style={styles.flex}
          />
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.types}>
          {EVENT_TYPES.map((meta) => (
            <AuraChip
              key={meta.id}
              label={t(`itinerary.types.${meta.id}`)}
              icon={meta.icon}
              dot={meta.id === type ? undefined : auraEventColors[meta.id]}
              selected={meta.id === type}
              onPress={() => changeType(meta.id)}
            />
          ))}
        </View>
        {type === "transit" ? (
          <View style={styles.types}>
            {TRANSIT_MODES.map((mode) => (
              <AuraChip
                key={mode.id}
                label={t(`itinerary.transitModes.${mode.id}`)}
                icon={mode.icon}
                selected={mode.id === transitMode}
                onPress={() => setTransitMode((current) => (current === mode.id ? undefined : mode.id))}
              />
            ))}
          </View>
        ) : null}
        <AuraField label={t("itinerary.form.title")} value={title} onChangeText={setTitle} placeholder={t("itinerary.form.titlePlaceholder")} returnKeyType="next" />
        <AuraField label={t("itinerary.form.detail")} value={detail} onChangeText={setDetail} placeholder={t("itinerary.form.detailPlaceholder")} />
        {untimedAllowed ? (
          <AuraSegmented
            options={[
              { value: "time", label: t("itinerary.form.atTime") },
              { value: "anytime", label: t("itinerary.form.anytime") },
              { value: "wishlist", label: t("itinerary.form.wishlist") },
            ]}
            value={whenKind}
            onChange={setWhenKind}
          />
        ) : null}
        {whenKind === "wishlist" ? (
          <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.form.wishlistHint")}</Text>
        ) : (
          <AuraDateField
            label={
              whenKind === "anytime"
                ? t("itinerary.form.day")
                : type === "stay"
                  ? t("itinerary.defaults.checkIn")
                  : type === "transit"
                    ? t("itinerary.defaults.departure")
                    : t("itinerary.form.when")
            }
            value={when}
            onChange={changeWhen}
            withTime={whenKind === "time"}
          />
        )}
        {hasEnd ? (
          <AuraDateField
            label={type === "stay" ? t("itinerary.defaults.checkOut") : t("itinerary.defaults.arrival")}
            value={until}
            onChange={setUntil}
            minimumDate={when}
            withTime
          />
        ) : null}
        <View style={styles.people}>
          <Text style={[styles.peopleLabel, { color: c.textSoft, fontFamily: f.medium }]}>{t("tickets.title")}</Text>
          {event ? (
            <>
              {tickets.map((ticket) => (
                <PressableScale
                  key={ticket.id}
                  onPress={() => onOpenTicket(ticket.id)}
                  accessibilityRole="button"
                  style={[styles.ticket, { backgroundColor: c.surface, borderColor: c.hairline }]}
                >
                  <Icon name={ticket.kind === "pdf" ? "ticket" : "camera"} size={15} color={c.textSoft} />
                  <Text numberOfLines={1} style={[styles.ticketName, { color: c.text, fontFamily: f.medium }]}>
                    {ticket.name}
                  </Text>
                  <Icon name="chevronRight" size={13} color={c.textMuted} />
                </PressableScale>
              ))}
              <View style={styles.types}>
                <AuraChip label={t("tickets.addFile")} icon="ticket" onPress={() => void addTickets("file")} />
                <AuraChip label={t("tickets.addPhoto")} icon="camera" onPress={() => void addTickets("photo")} />
              </View>
              <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("tickets.onlyHere")}</Text>
            </>
          ) : (
            <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("tickets.saveFirst")}</Text>
          )}
        </View>
        {companions.length > 0 ? (
          <View style={styles.people}>
            <Text style={[styles.peopleLabel, { color: c.textSoft, fontFamily: f.medium }]}>{t("itinerary.form.whoFor")}</Text>
            <View style={styles.types}>
              <AuraChip label={t("itinerary.form.everyone")} icon="users" selected={people.length === 0} onPress={() => setPeople([])} />
              {everyone.map((person) => (
                <AuraChip
                  key={person}
                  label={person === SELF_ID ? t("itinerary.form.you") : person}
                  selected={people.includes(person)}
                  onPress={() => togglePerson(person)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8, gap: 18 },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { fontSize: 13.5, lineHeight: 19 },
  people: { gap: 10 },
  ticket: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 46, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  ticketName: { flex: 1, fontSize: 14 },
  peopleLabel: { fontSize: 13.5 },
  actions: { flexDirection: "row", gap: 10 },
  delete: { paddingHorizontal: 18 },
  flex: { flex: 1 },
});
