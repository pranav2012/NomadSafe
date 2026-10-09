import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraSheet, Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { auraCategoryColors, auraHitSlop } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { showInterstitial } from "@/modules/ads";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";
import { EmailTextSheet } from "@/features/expenses/components/EmailTextSheet";
import {
  confirmAllProposals,
  confirmEditedBooking,
  confirmProposal,
  dismissProposals,
  finishEditedSpend,
} from "@/features/expenses/services/gmailReview";
import {
  useGmailInboxStore,
  useGmailReviewSheet,
  type BookingProposal,
  type GmailProposal,
  type SpendProposal,
} from "@/features/expenses/store/gmailInboxStore";
import { EventForm, type EventFormValues } from "@/features/itinerary/components/EventForm";
import { EVENT_TYPES, TRANSIT_MODES } from "@/features/itinerary/constants/eventTypes";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { transitModeOf } from "@/features/itinerary/utils/transit";
import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { fromDateKey } from "@/features/trips/utils/dates";

const proposalDate = (proposal: GmailProposal) => (proposal.kind === "spend" ? proposal.expense.date : proposal.event.startAt);

/** Opens the review sheet for a trip, counting what's waiting. */
export function openGmailReview(tripId: string, from: "trip" | "money" | "import") {
  const proposals = useGmailInboxStore.getState().proposals.filter((proposal) => proposal.tripId === tripId);
  if (proposals.length === 0) return;
  track("gmail_review_opened", {
    from,
    bookings: proposals.filter((proposal) => proposal.kind === "booking").length,
    spends: proposals.filter((proposal) => proposal.kind === "spend").length,
  });
  useGmailReviewSheet.getState().open(tripId);
}

/** "5 found in Gmail · Review" on a trip's itinerary and money; hidden when nothing is waiting. */
export function GmailReviewCard({ tripId, from }: { tripId: string; from: "trip" | "money" }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const count = useGmailInboxStore((state) => state.proposals.filter((proposal) => proposal.tripId === tripId).length);
  if (count === 0) return null;
  return (
    <PressableScale onPress={() => openGmailReview(tripId, from)} pressedScale={0.98} accessibilityRole="button">
      <AuraCard style={styles.card}>
        <View style={styles.cardRow}>
          <Icon name="mail" size={16} color={c.textSoft} />
          <Text style={[styles.cardText, { color: c.text, fontFamily: f.regular }]}>{t("gmailReview.card", { count })}</Text>
          <Text style={[styles.cardAction, { color: c.text, fontFamily: f.semibold }]}>{t("gmailReview.review")}</Text>
          <Icon name="chevronRight" size={14} color={c.textMuted} />
        </View>
      </AuraCard>
    </PressableScale>
  );
}

/** The trip's Gmail finds waiting for review; mounted once in the root layout and opened with `openGmailReview`. */
export function GmailReviewSheet() {
  const { t } = useLocalization();
  const tripId = useGmailReviewSheet((state) => state.tripId);
  const close = useGmailReviewSheet((state) => state.close);
  const trip = useTripsStore((state) => (tripId ? (state.trips.find((item) => item.id === tripId) ?? null) : null));

  useEffect(() => {
    if (tripId && !trip) close();
  }, [tripId, trip, close]);

  return (
    <AuraSheet visible={trip !== null} onClose={close} full title={t("gmailReview.title")} subtitle={trip?.name}>
      {trip ? <ReviewBody trip={trip} onDone={close} /> : null}
    </AuraSheet>
  );
}

function ReviewBody({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const all = useGmailInboxStore((state) => state.proposals);
  const proposals = useMemo(
    () => all.filter((proposal) => proposal.tripId === trip.id).sort((a, b) => proposalDate(a).localeCompare(proposalDate(b))),
    [all, trip.id],
  );
  const [editing, setEditing] = useState<GmailProposal | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const bookings = proposals.filter((proposal): proposal is BookingProposal => proposal.kind === "booking");
  const spends = proposals.filter((proposal): proposal is SpendProposal => proposal.kind === "spend");

  useEffect(() => {
    if (proposals.length === 0 && !editing) onDone();
  }, [proposals.length, editing, onDone]);

  const confirmAll = () => {
    if (confirmAllProposals(trip.id) > 0) showInterstitial("expenses_imported");
    onDone();
  };

  const saveBooking = (proposal: BookingProposal, values: EventFormValues) => {
    confirmEditedBooking(proposal, {
      ...proposal.event,
      type: values.type,
      title: values.title,
      detail: values.detail || undefined,
      transitMode: values.transitMode,
      startAt: values.startAt,
      endAt: values.endAt,
      timing: values.timing,
      people: values.people,
      where: values.where,
      link: values.link,
      travel: values.travel,
      bookingRef: values.bookingRef,
    });
    setEditing(null);
  };

  const renderRow = (proposal: GmailProposal) => (
    <ProposalRow
      key={proposal.id}
      proposal={proposal}
      trip={trip}
      onConfirm={() => confirmProposal(proposal)}
      onEdit={() => setEditing(proposal)}
      onDismiss={() => dismissProposals([proposal])}
      onEmail={() => setEmail(proposal.kind === "spend" ? (proposal.expense.rawText ?? "") : proposal.emailText)}
    />
  );

  return (
    <PrivateView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t("gmailReview.intro")}</Text>
        {bookings.length > 0 ? (
          <Text style={[styles.section, { color: c.textMuted, fontFamily: f.medium }]}>{t("gmailReview.bookings", { count: bookings.length })}</Text>
        ) : null}
        {bookings.map(renderRow)}
        {spends.length > 0 ? (
          <Text style={[styles.section, { color: c.textMuted, fontFamily: f.medium }]}>{t("gmailReview.spends", { count: spends.length })}</Text>
        ) : null}
        {spends.map(renderRow)}
      </ScrollView>
      <View style={styles.footer}>
        <AuraButton label={t("gmailReview.confirmAll", { count: proposals.length })} icon="check" onPress={confirmAll} disabled={proposals.length === 0} />
      </View>

      {editing?.kind === "spend" ? (
        <ExpenseForm
          visible
          source="email"
          groupId={trip.id}
          initialDraft={{
            amount: editing.expense.amount,
            currency: editing.expense.currency,
            merchant: editing.expense.merchant,
            category: editing.expense.category,
            date: editing.expense.date,
            paidBy: editing.expense.paidBy,
            shares: editing.expense.shares,
            splitHint: editing.expense.splitHint,
            rawText: editing.expense.rawText,
            note: editing.expense.note,
            externalId: editing.expense.externalId,
            pocketId: null,
          }}
          onSave={() => {
            finishEditedSpend(editing);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "booking" ? (
        <EventForm
          key={editing.id}
          event={null}
          draft={editing.event}
          tripStart={fromDateKey(trip.startDate)}
          companions={trip.companions}
          sharedTrip={Boolean(trip.shared)}
          onAskForTicket={() => undefined}
          onOpenTicket={() => undefined}
          visible
          onSave={(values) => saveBooking(editing, values)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <EmailTextSheet text={email} onClose={() => setEmail(null)} />
    </PrivateView>
  );
}

function bookingIcon(proposal: BookingProposal): IconName {
  const event = proposal.event;
  if (event.type === "transit") {
    const mode = transitModeOf(event);
    return TRANSIT_MODES.find((item) => item.id === mode)?.icon ?? "car";
  }
  return EVENT_TYPES.find((item) => item.id === event.type)?.icon ?? "ticket";
}

function ProposalRow({
  proposal,
  trip,
  onConfirm,
  onEdit,
  onDismiss,
  onEmail,
}: {
  proposal: GmailProposal;
  trip: Trip;
  onConfirm: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onEmail: () => void;
}) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso));

  let icon: IconName;
  let tone: string | undefined;
  let title: string;
  let amount: string | null = null;
  const meta: string[] = [];
  if (proposal.kind === "spend") {
    const spend = proposal.expense;
    icon = "receipt";
    tone = auraCategoryColors[spend.category];
    title = spend.merchant;
    amount = formatCurrency(spend.amount, spend.currency, {});
    meta.push(day(spend.date), t(`expenses.category.${spend.category}`));
    if (trip.companions.length > 0) {
      meta.push(
        spend.shares?.length
          ? spend.shares.length === trip.companions.length + 1
            ? t("gmailReview.splitEveryone")
            : t("gmailReview.splitWith", { count: spend.shares.length })
          : spend.splitHint
            ? t("gmailReview.splitHint", { count: spend.splitHint.pax })
            : t("gmailReview.justYou"),
      );
    }
  } else {
    const event = proposal.event;
    icon = bookingIcon(proposal);
    title = localizeEventTitle(event.title, t);
    meta.push(event.endAt && day(event.endAt) !== day(event.startAt) ? `${day(event.startAt)} – ${day(event.endAt)}` : day(event.startAt));
    const detail = localizeEventDetail(event.detail, t);
    if (detail) meta.push(detail);
    if (proposal.files.length > 0) meta.push(t("gmailReview.files", { count: proposal.files.length }));
  }

  return (
    <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowIcon, { backgroundColor: tone ? `${tone}1F` : c.surfaceStrong }]}>
          <Icon name={icon} size={15} color={tone ?? c.text} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.rowTitle, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.rowMeta, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={2}>
            {meta.join(" · ")}
          </Text>
        </View>
        {amount ? <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>{amount}</Text> : null}
      </View>
      <View style={styles.actions}>
        <PressableScale onPress={onConfirm} accessibilityRole="button" style={[styles.confirm, { backgroundColor: c.inverse }]}>
          <Icon name="check" size={13} color={c.onInverse} strokeWidth={3} />
          <Text style={[styles.confirmText, { color: c.onInverse, fontFamily: f.semibold }]}>{t("gmailReview.confirm")}</Text>
        </PressableScale>
        <RowAction icon="edit" label={t("gmailReview.edit")} onPress={onEdit} />
        <RowAction icon="mail" label={t("gmailReview.viewEmail")} onPress={onEmail} />
        <View style={styles.flex} />
        <RowAction icon="x" label={t("gmailReview.dismiss")} onPress={onDismiss} />
      </View>
    </View>
  );
}

function RowAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={auraHitSlop(32)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.iconButton, { backgroundColor: c.surfaceStrong }]}
    >
      <Icon name={icon} size={14} color={c.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginBottom: 12, paddingVertical: 12 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  cardAction: { fontSize: 13.5 },
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 10 },
  intro: { fontSize: 14, lineHeight: 20 },
  section: { fontSize: 12.5, letterSpacing: 0.3, marginTop: 8, textTransform: "uppercase" },
  row: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15 },
  rowMeta: { fontSize: 12, marginTop: 2 },
  amount: { fontSize: 15, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  confirm: { flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: 14, borderRadius: 16 },
  confirmText: { fontSize: 13 },
  iconButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: 20, paddingTop: 10 },
});
