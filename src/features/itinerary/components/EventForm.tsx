import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraDateField, AuraField, AuraSegmented, AuraSheet, AuraSwitch, Icon, PressableScale, showToast, useAura } from "@/atoms";
import { track } from "@/modules/analytics";
import { attachFiles, attachPhotos, sendTicket, setTicketShared } from "@/features/itinerary/services/tickets";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { auraEventColors, auraHitSlop } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { SELF_ID } from "@/features/expenses/utils/split";
import { EVENT_TYPES, TRANSIT_MODES, canBeUntimed, type EventTiming, type EventType, type TransitMode } from "@/features/itinerary/constants/eventTypes";
import type { EventLink, TripEvent } from "@/features/itinerary/store/eventsStore";
import type { ScreenshotRead } from "@/features/itinerary/services/ticketScreenshot";
import { classifyLink } from "@/features/itinerary/utils/sharedLinks";
import { TRAVEL_FIELDS, type TravelDetails, type TravelField } from "@/features/itinerary/utils/travelDetails";
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
  /** The place as the user typed it; undefined when left empty. */
  where?: string;
  link?: EventLink;
  travel?: TravelDetails;
  bookingRef?: string;
  /** A screenshot the item was filled from, to keep as its ticket once saved. */
  screenshot?: { uri: string; name: string };
}

type When = "time" | EventTiming;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DETAIL_SEPARATOR = " · ";
const TRAVEL_FIELDS_BY_MODE: Record<TransitMode, TravelField[]> = {
  flight: ["terminal", "gate", "seat"],
  train: ["platform", "coach", "seat"],
  bus: ["platform", "seat"],
  ferry: ["terminal", "seat"],
  car: [],
};

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

/** Travel details the form shows for this mode, trimmed; boarding time only when set. */
function cleanTravel(travel: TravelDetails, boarding: Date | null, fields: TravelField[]): TravelDetails | undefined {
  const kept: TravelDetails = {};
  for (const field of TRAVEL_FIELDS) {
    const value = fields.includes(field) ? travel[field]?.trim() : undefined;
    if (value) kept[field] = value.toUpperCase();
  }
  if (boarding) kept.boardingAt = toWallClock(boarding);
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Sheet to create or edit a single itinerary event; shows Delete when editing. */
export function EventForm({
  event,
  defaultStart,
  tripStart,
  companions,
  onOpenTicket,
  sharedTrip,
  onAskForTicket,
  readScreenshot,
  prefill,
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
  /** Shared trips: tickets get a "Visible to the group" switch, and others' tickets can be asked for. */
  sharedTrip: boolean;
  onAskForTicket: () => void;
  /** New items: picks a ticket screenshot and reads it on the phone, to fill the form. */
  readScreenshot?: () => Promise<ScreenshotRead | null>;
  /** A screenshot already read before the form opened: fills a new item and is kept as its ticket. */
  prefill?: ScreenshotRead | null;
  visible: boolean;
  onSave: (values: EventFormValues) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const { c, f } = useAura();

  // The parent remounts this form (via `key`) for each open, so state initializes fresh from props.
  const seed = event ? null : (prefill?.booking ?? null);
  const [type, setType] = useState<EventType>(event?.type ?? seed?.type ?? "activity");
  const [title, setTitle] = useState(event ? localizeEventTitle(event.title, t) : (seed?.title ?? ""));
  const [initialDetail] = useState(() => (event ? (localizeEventDetail(event.detail, t) ?? "") : (seed?.detail ?? "")));
  const [detail, setDetail] = useState(initialDetail);
  const [transitMode, setTransitMode] = useState<TransitMode | undefined>(() => (event ? transitModeOf(event) : seed?.transitMode));
  const [when, setWhen] = useState<Date>(() => (event ? new Date(event.startAt) : seed ? new Date(seed.startAt) : (defaultStart ?? new Date())));
  const [until, setUntil] = useState<Date>(() =>
    event?.endAt
      ? new Date(event.endAt)
      : seed?.endAt
        ? new Date(seed.endAt)
        : new Date((event ? new Date(event.startAt) : (defaultStart ?? new Date())).getTime() + DAY_MS),
  );
  const [pickedWhen, setWhenKind] = useState<When>(event?.timing ?? "time");
  const [people, setPeople] = useState<string[]>(event?.people ?? []);
  const [where, setWhere] = useState(event?.where ?? "");
  const [link, setLink] = useState(event?.link?.url ?? "");
  const [travel, setTravel] = useState<TravelDetails>(event?.travel ?? seed?.travel ?? {});
  const [boarding, setBoarding] = useState<Date | null>(() => {
    const boardingAt = event ? event.travel?.boardingAt : seed?.travel?.boardingAt;
    return boardingAt ? new Date(boardingAt) : null;
  });
  const [showEnd, setShowEnd] = useState(Boolean(event?.endAt ?? seed?.endAt));
  const [bookingRef, setBookingRef] = useState(event?.bookingRef ?? seed?.bookingRef);
  const [screenshot, setScreenshot] = useState<ScreenshotRead | null>(event ? null : (prefill ?? null));
  const [reading, setReading] = useState(false);
  const allTickets = useTicketsStore((state) => state.tickets);
  const tickets = event ? allTickets.filter((ticket) => ticket.eventId === event.id) : [];
  const others = (event?.ticketHolders ?? []).filter((person) => person !== SELF_ID);
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
  // Stays always have a check-out; other items show an end (arrival for transit) once known or added.
  const hasEnd = whenKind === "time" && ((type === "stay" && !isLoneCheckOut) || (type !== "stay" && type !== "note" && showEnd));
  const canSave = title.trim().length > 0;
  const linkValue = link.trim() ? classifyLink(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`) : null;
  const travelFields = type === "transit" && transitMode ? TRAVEL_FIELDS_BY_MODE[transitMode] : type === "transit" ? (["seat"] as TravelField[]) : [];
  const placeable = type === "activity" || type === "food" || type === "stay";

  const fillFromScreenshot = async () => {
    if (!readScreenshot || reading) return;
    setReading(true);
    try {
      const read = await readScreenshot();
      if (!read) return;
      setScreenshot(read);
      const booking = read.booking;
      track("ticket_screenshot_read", { found: Boolean(booking) });
      if (!booking) {
        showToast(t("itinerary.form.screenshotNothing"));
        return;
      }
      setType(booking.type);
      setTitle(booking.title);
      setDetail(booking.detail ?? "");
      setTransitMode(booking.transitMode);
      setWhenKind("time");
      setWhen(new Date(booking.startAt));
      if (booking.endAt) {
        setUntil(new Date(booking.endAt));
        setShowEnd(true);
      }
      setTravel(booking.travel ?? {});
      setBoarding(booking.travel?.boardingAt ? new Date(booking.travel.boardingAt) : null);
      setBookingRef(booking.bookingRef);
      showToast(t("itinerary.form.screenshotFilled"));
    } finally {
      setReading(false);
    }
  };

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
      where: placeable && where.trim() ? where.trim() : undefined,
      link: linkValue ? { url: linkValue.url, provider: linkValue.provider, ...(linkValue.author ? { author: linkValue.author } : null) } : undefined,
      travel: type === "transit" ? cleanTravel(travel, boarding, travelFields) : undefined,
      bookingRef,
      screenshot: screenshot ? { uri: screenshot.uri, name: screenshot.name } : undefined,
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
        {!event && readScreenshot ? (
          <PressableScale
            onPress={() => void fillFromScreenshot()}
            accessibilityRole="button"
            style={[styles.screenshot, { backgroundColor: c.surface, borderColor: c.hairline }]}
          >
            <View style={[styles.screenshotIcon, { backgroundColor: c.surfaceStrong }]}>
              {reading ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="camera" size={16} color={c.text} />}
            </View>
            <View style={styles.flex}>
              <Text style={[styles.screenshotTitle, { color: c.text, fontFamily: f.semibold }]}>
                {screenshot ? t("itinerary.form.screenshotAgain") : t("itinerary.form.screenshotTitle")}
              </Text>
              <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.form.screenshotBody")}</Text>
            </View>
          </PressableScale>
        ) : null}
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
            label={type === "stay" ? t("itinerary.defaults.checkOut") : type === "transit" ? t("itinerary.defaults.arrival") : t("itinerary.form.ends")}
            value={until}
            onChange={setUntil}
            minimumDate={when}
            withTime
          />
        ) : whenKind === "time" && type !== "stay" && type !== "note" ? (
          <AuraChip
            label={type === "transit" ? t("itinerary.form.addArrival") : t("itinerary.form.addEnd")}
            icon="clock"
            onPress={() => {
              setUntil(new Date(when.getTime() + (type === "transit" ? HOUR_MS : 2 * HOUR_MS)));
              setShowEnd(true);
            }}
          />
        ) : null}
        {placeable ? (
          <AuraField
            label={t("itinerary.form.where")}
            value={where}
            onChangeText={setWhere}
            placeholder={event?.place?.name ?? t("itinerary.form.wherePlaceholder")}
            returnKeyType="next"
          />
        ) : null}
        {travelFields.length > 0 ? (
          <View style={styles.people}>
            <Text style={[styles.peopleLabel, { color: c.textSoft, fontFamily: f.medium }]}>{t("itinerary.travel.title")}</Text>
            <View style={styles.travelRow}>
              {travelFields.map((field) => (
                <View key={field} style={styles.travelField}>
                  <AuraField
                    label={t(`itinerary.travel.${field}`)}
                    value={travel[field] ?? ""}
                    onChangeText={(value) => setTravel((current) => ({ ...current, [field]: value }))}
                    autoCapitalize="characters"
                  />
                </View>
              ))}
            </View>
            {boarding ? (
              <AuraDateField label={t("itinerary.travel.boarding")} value={boarding} onChange={setBoarding} withTime />
            ) : (
              <AuraChip label={t("itinerary.travel.addBoarding")} icon="clock" onPress={() => setBoarding(new Date(when.getTime() - 45 * 60_000))} />
            )}
          </View>
        ) : null}
        <AuraField
          label={t("itinerary.form.link")}
          value={link}
          onChangeText={setLink}
          placeholder={t("itinerary.form.linkPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <View style={styles.people}>
          <Text style={[styles.peopleLabel, { color: c.textSoft, fontFamily: f.medium }]}>{t("tickets.title")}</Text>
          {event ? (
            <>
              {tickets.map((ticket) => (
                <View key={ticket.id} style={[styles.ticketCard, { backgroundColor: c.surface, borderColor: c.hairline }]}>
                  <PressableScale onPress={() => onOpenTicket(ticket.id)} accessibilityRole="button" style={styles.ticket}>
                    <Icon name={ticket.kind === "pdf" ? "ticket" : "camera"} size={15} color={c.textSoft} />
                    <Text numberOfLines={1} style={[styles.ticketName, { color: c.text, fontFamily: f.medium }]}>
                      {ticket.name}
                    </Text>
                    <PressableScale
                      onPress={() => void sendTicket(ticket)}
                      hitSlop={auraHitSlop(32)}
                      accessibilityRole="button"
                      accessibilityLabel={t("tickets.send")}
                      style={[styles.send, { backgroundColor: c.surfaceStrong }]}
                    >
                      <Icon name="share" size={14} color={c.text} />
                    </PressableScale>
                  </PressableScale>
                  {sharedTrip ? (
                    <View style={[styles.visible, { borderTopColor: c.hairline }]}>
                      <Text style={[styles.visibleText, { color: c.textSoft, fontFamily: f.regular }]}>{t("tickets.visibleToGroup")}</Text>
                      <AuraSwitch
                        value={ticket.shared !== false}
                        onValueChange={(next) => setTicketShared(ticket, next)}
                        accessibilityLabel={t("tickets.visibleToGroup")}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
              {others.length > 0 && tickets.length === 0 ? (
                <View style={[styles.ticketCard, styles.ticket, { backgroundColor: c.surface, borderColor: c.hairline }]}>
                  <Icon name="users" size={15} color={c.textSoft} />
                  <Text numberOfLines={1} style={[styles.ticketName, { color: c.text, fontFamily: f.medium }]}>
                    {t("tickets.heldBy", { names: others.join(", ") })}
                  </Text>
                  <AuraButton size="md" variant="secondary" label={t("tickets.ask")} onPress={onAskForTicket} />
                </View>
              ) : null}
              <View style={styles.types}>
                <AuraChip label={t("tickets.addFile")} icon="ticket" onPress={() => void addTickets("file")} />
                <AuraChip label={t("tickets.addPhoto")} icon="camera" onPress={() => void addTickets("photo")} />
              </View>
              <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("tickets.onlyHere")}</Text>
            </>
          ) : screenshot ? (
            <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.form.screenshotKept")}</Text>
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
  screenshot: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  screenshotIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  screenshotTitle: { fontSize: 15 },
  travelRow: { flexDirection: "row", gap: 8 },
  travelField: { flex: 1 },
  people: { gap: 10 },
  ticketCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  ticket: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 50 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  visible: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  visibleText: { fontSize: 13.5 },
  ticketName: { flex: 1, fontSize: 14 },
  peopleLabel: { fontSize: 13.5 },
  actions: { flexDirection: "row", gap: 10 },
  delete: { paddingHorizontal: 18 },
  flex: { flex: 1 },
});
