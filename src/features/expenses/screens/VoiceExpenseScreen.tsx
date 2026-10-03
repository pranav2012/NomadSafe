import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { PostHogMaskView } from "posthog-react-native";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { track } from "@/services/analytics";
import { logger } from "@/services/logger";
import { useAuthStore } from "@/features/auth";
import { useSettingsStore } from "@/features/settings";
import { localModelService } from "@/features/ai/services/localModelService";
import { useAiReadyModelId } from "@/features/ai/hooks/useAiProvisioning";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useSpeechCapture } from "@/features/expenses/hooks/useSpeechCapture";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";
import { VoiceDraftCard } from "@/features/expenses/components/VoiceDraftCard";
import {
  interpretVoiceExtraction,
  replaceDraftPerson,
  type VoiceExpenseDraft,
  type VoiceSettlementDraft,
} from "@/features/expenses/services/voiceExpense";
import { formatMoney } from "@/features/expenses/utils/money";
import { resolveShares } from "@/features/expenses/utils/split";
import { resolveWidgetTrip, setWidgetTripId } from "@/features/widget/widgetTrip";
import { syncWidgets } from "@/features/widget/syncWidgets";

type Phase =
  | { name: "idle" }
  | { name: "thinking"; transcript: string }
  | { name: "review"; draft: VoiceExpenseDraft | VoiceSettlementDraft }
  | { name: "unclear"; transcript: string }
  | { name: "saved"; summary: string };

/** Speak-to-add screen. It also runs while PIN-locked, so it never shows the ledger or balances. */
export default function VoiceExpenseScreen() {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, formatCurrency, currency: deviceCurrency } = useLocalization();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId?: string; autostart?: string; pickTrip?: string; source?: string }>();
  const fromWidget = params.source === "widget";

  const trips = useTripsStore((state) => state.trips);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  const updateTrip = useTripsStore((state) => state.updateTrip);
  const addExpense = useExpensesStore((state) => state.addExpense);
  const addSettlement = useExpensesStore((state) => state.addSettlement);
  const locked = useAuthStore((state) => state.isSignedIn && state.isPinSet && !state.isUnlocked);
  const localAiEnabled = useSettingsStore((state) => state.localAiEnabled);
  const modelId = useAiReadyModelId();

  const [tripId, setTripId] = useState<string | null>(
    () => (params.tripId && trips.some((trip) => trip.id === params.tripId) ? params.tripId : null) ??
      (fromWidget ? resolveWidgetTrip()?.id : activeTripId) ??
      trips[0]?.id ??
      null,
  );
  const trip = trips.find((entry) => entry.id === tripId) ?? null;
  const companions = useMemo(() => trip?.companions ?? [], [trip]);
  const tripCurrency = trip?.currency ?? deviceCurrency;
  const [pickerOpen, setPickerOpen] = useState(params.pickTrip === "1" && trips.length > 1);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [editing, setEditing] = useState(false);
  const runId = useRef(0);

  const handleTranscript = useCallback(
    async (transcript: string) => {
      const run = ++runId.current;
      setPhase({ name: "thinking", transcript });
      try {
        const raw = await localModelService.extractVoiceExpense(transcript, companions);
        if (run !== runId.current) return;
        const draft = interpretVoiceExtraction(raw, transcript, {
          companions,
          tripCurrency,
        });
        if (draft.kind === "unclear") {
          track("voice_capture_failed", { reason: "unclear" });
          setPhase({ name: "unclear", transcript });
        } else {
          void Haptics.selectionAsync();
          setPhase({ name: "review", draft });
        }
      } catch (error) {
        if (run !== runId.current) return;
        logger.warn("voiceExpense", "extraction failed", error);
        track("voice_capture_failed", { reason: "model_error" });
        setPhase({ name: "unclear", transcript });
      }
    },
    [companions, tripCurrency],
  );

  const contextualStrings = useMemo(() => [...companions, "split", "everyone"], [companions]);
  const speech = useSpeechCapture({ onFinal: handleTranscript, contextualStrings });
  const modelReady = localAiEnabled && modelId !== null;

  useEffect(() => {
    track("voice_capture_opened", { from_widget: fromWidget, locked });
    void localModelService.preload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autostarted = useRef(false);
  useEffect(() => {
    if (autostarted.current || params.autostart !== "1" || !modelReady || pickerOpen) return;
    autostarted.current = true;
    void speech.start();
  }, [params.autostart, modelReady, pickerOpen, speech]);

  useEffect(() => {
    if (speech.state.status === "unavailable") track("voice_capture_failed", { reason: "speech_unavailable" });
  }, [speech.state.status]);

  const close = () => {
    runId.current += 1;
    speech.cancel();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/expenses");
  };

  const listen = () => {
    runId.current += 1;
    setPhase({ name: "idle" });
    void speech.start();
  };

  const selectTrip = (id: string) => {
    setTripId(id);
    setPickerOpen(false);
    setPhase({ name: "idle" });
    if (fromWidget) {
      setWidgetTripId(id);
      void syncWidgets();
    }
  };

  const draft = phase.name === "review" ? phase.draft : null;
  const shares =
    draft?.kind === "expense" && draft.people.length > 0
      ? resolveShares(draft.amount, draft.currency, draft.people, draft.explicitShares)
      : null;

  const updateDraft = (next: VoiceExpenseDraft | VoiceSettlementDraft) => setPhase({ name: "review", draft: next });

  const addPerson = (name: string) => {
    if (!trip || !draft) return;
    updateTrip(trip.id, { companions: [...trip.companions, name], mode: "group" });
    updateDraft(replaceDraftPerson(draft, name, name));
  };

  const saveDraft = useCallback(
    (auto: boolean) => {
      if (phase.name !== "review") return;
      const current = phase.draft;
      const amount = formatMoney(formatCurrency, current.amount, current.currency);
      if (current.kind === "settlement") {
        if (!trip || current.from === current.to) return;
        addSettlement({
          tripId: trip.id,
          from: current.from,
          to: current.to,
          amount: current.amount,
          currency: current.currency,
          date: current.date,
          source: "voice",
        });
        track("settlement_recorded", { source: "voice" });
        track("voice_draft_saved", { kind: "settlement", split: false, edited: false, auto });
        setPhase({ name: "saved", summary: t("voiceExpense.savedPayment", { amount }) });
      } else {
        const resolution =
          current.people.length > 0
            ? resolveShares(current.amount, current.currency, current.people, current.explicitShares)
            : null;
        if (resolution && !resolution.ok) return;
        const merchant = current.merchant || t(`expenses.category.${current.category}`);
        addExpense({
          tripId: trip?.id ?? null,
          merchant,
          amount: current.amount,
          currency: current.currency,
          category: current.category,
          date: current.date,
          source: "voice",
          rawText: current.transcript,
          autoCategorized: true,
          paidBy: resolution ? current.paidBy : undefined,
          shares: resolution?.shares.filter((share) => share.amount > 0),
        });
        track("expense_added", { source: "voice", count: 1 });
        track("voice_draft_saved", { kind: "expense", split: Boolean(resolution), edited: false, auto });
        setPhase({
          name: "saved",
          summary: resolution
            ? t("voiceExpense.savedSplit", { amount, merchant, count: resolution.shares.length })
            : t("voiceExpense.saved", { amount, merchant }),
        });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [phase, trip, addExpense, addSettlement, formatCurrency, t],
  );

  const listening = speech.state.status === "listening";
  const partial = speech.state.status === "listening" ? speech.state.partial : "";

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.paper }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>{t("voiceExpense.eyebrow")}</Text>
            <Text style={[styles.title, { color: theme.inkDeep }]}>{t("voiceExpense.title")}</Text>
          </View>
          <Pressable
            onPress={close}
            hitSlop={10}
            accessibilityLabel={t("common.close")}
            style={[styles.closeButton, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
          >
            <Icon name="x" size={18} color={theme.inkSoft} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => trips.length > 0 && setPickerOpen(true)}
          style={[styles.tripSelect, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
        >
          <Icon name="compass" size={17} color={theme.teal} />
          <View style={styles.flex}>
            <Text style={[styles.tripLabel, { color: theme.inkMuted }]}>{t("voiceExpense.addingTo")}</Text>
            <Text style={[styles.tripName, { color: theme.inkDeep }]} numberOfLines={1}>
              {trip?.name ?? t("voiceExpense.noTrip")}
            </Text>
          </View>
          {trips.length > 1 ? <Icon name="chevronDown" size={18} color={theme.inkSoft} /> : null}
        </Pressable>

        {!modelReady ? (
          <View style={[styles.infoCard, { backgroundColor: theme.mustardSoft, borderColor: theme.mustard }]}>
            <Icon name="cpu" size={20} color={theme.stamp} />
            <Text style={[styles.infoTitle, { color: theme.inkDeep }]}>{t("voiceExpense.needsModelTitle")}</Text>
            <Text style={[styles.infoBody, { color: theme.inkSoft }]}>
              {!localAiEnabled
                ? t("voiceExpense.needsModelDisabled")
                : locked
                  ? t("voiceExpense.needsModelLocked")
                  : t("voiceExpense.needsModelBody")}
            </Text>
            {!locked ? (
              <Pressable onPress={() => router.replace("/(tabs)/ai")} hitSlop={6}>
                <Text style={[styles.infoAction, { color: theme.teal }]}>{t("voiceExpense.openAi")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : phase.name === "review" && draft ? (
          <PostHogMaskView>
            <VoiceDraftCard
              key={draft.transcript}
              draft={draft}
              shares={shares}
              tripName={trip?.name ?? null}
              canAddPeople={trip !== null}
              onAddPerson={addPerson}
              onLeaveOut={(name) => updateDraft(replaceDraftPerson(draft, name, null))}
              onSave={saveDraft}
              onEdit={draft.kind === "expense" ? () => setEditing(true) : undefined}
              onRetry={listen}
            />
          </PostHogMaskView>
        ) : phase.name === "saved" ? (
          <View style={[styles.savedCard, { backgroundColor: theme.tealSoft, borderColor: theme.teal }]}>
            <View style={[styles.savedIcon, { backgroundColor: theme.teal }]}>
              <Icon name="check" size={22} color={theme.inverse} strokeWidth={2.6} />
            </View>
            <Text style={[styles.savedText, { color: theme.inkDeep }]}>{phase.summary}</Text>
            <View style={styles.savedActions}>
              <Pressable
                onPress={listen}
                style={({ pressed }) => [styles.secondary, { borderColor: theme.teal, opacity: pressed ? 0.85 : 1 }]}
              >
                <Icon name="mic" size={15} color={theme.teal} />
                <Text style={[styles.secondaryText, { color: theme.teal }]}>{t("voiceExpense.addAnother")}</Text>
              </Pressable>
              <Pressable
                onPress={close}
                style={({ pressed }) => [styles.primary, { backgroundColor: theme.teal, opacity: pressed ? 0.9 : 1 }]}
              >
                <Text style={[styles.primaryText, { color: theme.inverse }]}>{t("voiceExpense.done")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.micArea}>
            <Pressable
              onPress={listening ? speech.stop : listen}
              disabled={phase.name === "thinking"}
              accessibilityRole="button"
              accessibilityLabel={listening ? t("voiceExpense.stop") : t("voiceExpense.speakToAdd")}
              style={[
                styles.micHalo,
                {
                  backgroundColor: listening ? theme.tealSoft : "transparent",
                  transform: [{ scale: listening ? 1 + Math.min(speech.volume, 10) / 40 : 1 }],
                },
              ]}
            >
              <View style={[styles.micButton, { backgroundColor: listening ? theme.stamp : theme.teal }]}>
                {phase.name === "thinking" ? (
                  <ActivityIndicator color={theme.inverse} />
                ) : (
                  <Icon name={listening ? "pause" : "mic"} size={34} color={theme.inverse} />
                )}
              </View>
            </Pressable>

            <PostHogMaskView>
              <Text style={[styles.status, { color: theme.inkDeep }]}>
                {phase.name === "thinking"
                  ? t("voiceExpense.thinking")
                  : listening
                    ? partial || t("voiceExpense.listening")
                    : phase.name === "unclear"
                      ? t("voiceExpense.unclear")
                      : t("voiceExpense.tapToSpeak")}
              </Text>
              {phase.name === "thinking" || phase.name === "unclear" ? (
                <Text style={[styles.heard, { color: theme.inkSoft }]}>“{phase.transcript}”</Text>
              ) : null}
            </PostHogMaskView>

            {speech.state.status === "unavailable" ? (
              <SpeechProblem
                reason={speech.state.reason}
                locale={speech.state.locale}
                onDownload={speech.downloadLanguage}
              />
            ) : phase.name === "idle" && !listening ? (
              <View style={[styles.examples, { borderColor: theme.hairline }]}>
                <Text style={[styles.examplesLabel, { color: theme.inkMuted }]}>{t("voiceExpense.try")}</Text>
                <Text style={[styles.example, { color: theme.inkSoft }]}>{t("voiceExpense.example1")}</Text>
                <Text style={[styles.example, { color: theme.inkSoft }]}>{t("voiceExpense.example2")}</Text>
                <Text style={[styles.example, { color: theme.inkSoft }]}>{t("voiceExpense.example3")}</Text>
              </View>
            ) : null}
            <Text style={[styles.privacy, { color: theme.inkMuted }]}>{t("voiceExpense.privacy")}</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={[styles.picker, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
          <Text style={[styles.pickerTitle, { color: theme.inkDeep }]}>{t("voiceExpense.chooseTrip")}</Text>
          <ScrollView style={styles.pickerList}>
            {trips.map((entry) => {
              const active = entry.id === tripId;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => selectTrip(entry.id)}
                  style={[styles.pickerRow, { backgroundColor: active ? theme.tealSoft : "transparent" }]}
                >
                  <Text style={[styles.pickerName, { color: theme.inkDeep }]} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {entry.id === activeTripId ? (
                    <Text style={[styles.pickerBadge, { color: theme.teal }]}>{t("voiceExpense.activeTrip")}</Text>
                  ) : null}
                  {active ? <Icon name="check" size={16} color={theme.teal} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={editing && draft?.kind === "expense"}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(false)}
      >
        {draft?.kind === "expense" ? (
          <SafeAreaView edges={["top"]} style={[styles.flex, { backgroundColor: theme.paper }]}>
            <ExpenseForm
              initialDraft={{
                amount: draft.amount,
                currency: draft.currency,
                merchant: draft.merchant,
                category: draft.category,
                date: draft.date,
                paidBy: draft.paidBy,
                shares: shares?.ok ? shares.shares : undefined,
                rawText: draft.transcript,
              }}
              source="voice"
              tripId={trip?.id ?? null}
              tripCurrency={tripCurrency}
              companions={companions}
              onCancel={() => setEditing(false)}
              onSave={() => {
                setEditing(false);
                track("voice_draft_saved", { kind: "expense", split: Boolean(shares?.ok), edited: true, auto: false });
                setPhase({
                  name: "saved",
                  summary: t("voiceExpense.savedEdited"),
                });
              }}
            />
          </SafeAreaView>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

function SpeechProblem({
  reason,
  locale,
  onDownload,
}: {
  reason: string;
  locale?: string;
  onDownload: (locale: string) => Promise<string | null>;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  return (
    <View style={[styles.infoCard, { backgroundColor: theme.mustardSoft, borderColor: theme.mustard }]}>
      <Text style={[styles.infoBody, { color: theme.inkDeep }]}>{t(`voiceExpense.speech.${reason}`)}</Text>
      {reason === "language-missing" && locale && process.env.EXPO_OS === "android" ? (
        downloadStatus ? (
          <Text style={[styles.infoBody, { color: theme.inkSoft }]}>{t("voiceExpense.speech.downloadStarted")}</Text>
        ) : (
          <Pressable
            onPress={async () => setDownloadStatus((await onDownload(locale)) ?? "failed")}
            hitSlop={6}
          >
            <Text style={[styles.infoAction, { color: theme.teal }]}>{t("voiceExpense.speech.download")}</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { padding: 20, gap: 16, paddingBottom: 60 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: { fontFamily: NOMAD_FONTS.display, fontSize: 32, lineHeight: 36, marginTop: 4 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tripSelect: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tripLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  tripName: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 16, marginTop: 2 },
  infoCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  infoTitle: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 15 },
  infoBody: { fontFamily: NOMAD_FONTS.ui, fontSize: 13.5, lineHeight: 19 },
  infoAction: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 14 },
  micArea: { alignItems: "center", gap: 18, paddingTop: 24 },
  micHalo: { width: 150, height: 150, borderRadius: 75, alignItems: "center", justifyContent: "center" },
  micButton: { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center" },
  status: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 18, textAlign: "center", lineHeight: 25 },
  heard: { fontFamily: NOMAD_FONTS.ui, fontSize: 14, fontStyle: "italic", textAlign: "center", marginTop: 6 },
  examples: { alignSelf: "stretch", borderTopWidth: 1, paddingTop: 16, gap: 6 },
  examplesLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  example: { fontFamily: NOMAD_FONTS.ui, fontSize: 14, lineHeight: 20 },
  privacy: { fontFamily: NOMAD_FONTS.ui, fontSize: 12, textAlign: "center" },
  savedCard: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 14, alignItems: "center" },
  savedIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  savedText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 16, textAlign: "center", lineHeight: 22 },
  savedActions: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  primary: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 12 },
  primaryText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  picker: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "22%",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  pickerTitle: { fontFamily: NOMAD_FONTS.display, fontSize: 22 },
  pickerList: { maxHeight: 360 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerName: { flex: 1, fontFamily: NOMAD_FONTS.uiSemi, fontSize: 15 },
  pickerBadge: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
