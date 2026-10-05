import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { PrivateView, track } from "@/modules/analytics";
import {
  AuraButton,
  AuraCard,
  AuraChip,
  AuraSheet,
  Icon,
  PressableScale,
  useAura,
} from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";
import { useAuthStore } from "@/features/auth";
import { useSettingsStore } from "@/features/settings";
import { aiRuntime, aiService, remoteLabel, useAiAvailability } from "@/modules/ai";
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
import { VoiceOrb, type VoiceOrbMode } from "@/features/expenses/components/VoiceOrb";

type Phase =
  | { name: "idle" }
  | { name: "thinking"; transcript: string }
  | { name: "review"; draft: VoiceExpenseDraft | VoiceSettlementDraft }
  | { name: "unclear"; transcript: string }
  | { name: "saved"; summary: string };

/** Speak-to-add screen. It also runs while PIN-locked, so it never shows the ledger or balances. */
export default function VoiceExpenseScreen() {
  const { c, f, isDark } = useAura();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
  const ai = useAiAvailability("voiceExpense");

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
        const raw = await aiService.extractVoiceExpense(transcript, companions);
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
  const modelReady = ai.available;
  const onlineName = ai.remote ? remoteLabel(ai.remote, ai.byok, t("aiTab.cloudName")) : null;

  useEffect(() => {
    track("voice_capture_opened", { from_widget: fromWidget, locked });
    // Warming the on-device model costs memory and battery; skip it when online AI will answer.
    if (!ai.configured) void aiRuntime.preload();
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

  // Locked capture only adds expenses; changing who is on the trip needs the PIN.
  const addPerson = (name: string) => {
    if (!trip || !draft || locked) return;
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

  const orbMode: VoiceOrbMode =
    phase.name === "thinking" ? "thinking" : phase.name === "saved" ? "done" : listening ? "listening" : "idle";
  const compact = phase.name === "review";
  const orbSize = Math.min(compact ? 150 : 280, width - 80);
  const heard = phase.name === "thinking" || phase.name === "unclear" ? phase.transcript : phase.name === "review" ? phase.draft.transcript : partial;
  const status =
    phase.name === "thinking"
      ? onlineName ? t("voiceExpense.thinkingOnline") : t("voiceExpense.thinking")
      : listening
        ? t("voiceExpense.listening")
        : phase.name === "unclear"
          ? t("voiceExpense.unclear")
          : phase.name === "saved"
            ? phase.summary
            : phase.name === "review"
              ? null
              : t("voiceExpense.tapToSpeak");

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <PressableScale onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} style={[styles.close, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
          <AuraChip
            label={trip ? t("voiceExpense.addingToName", { name: trip.name }) : t("voiceExpense.noTrip")}
            icon="compass"
            onPress={trips.length > 1 ? () => setPickerOpen(true) : undefined}
          />
        </View>

        {!modelReady ? (
          <AuraCard tone={auraStatusAccent.live} style={styles.needsModel}>
            <Icon name="cpu" size={20} color={auraStatusAccent.live} />
            <Text style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>{t("voiceExpense.needsModelTitle")}</Text>
            <Text style={[styles.cardBody, { color: c.textSoft, fontFamily: f.regular }]}>
              {!localAiEnabled
                ? t("voiceExpense.needsModelDisabled")
                : locked
                  ? t("voiceExpense.needsModelLocked")
                  : t("voiceExpense.needsModelBody")}
            </Text>
            {!locked ? (
              <AuraButton label={t("voiceExpense.openAi")} icon="sparkle" variant="secondary" size="md" onPress={() => router.replace("/(tabs)/ai")} style={styles.start} />
            ) : null}
          </AuraCard>
        ) : (
          <>
            <Animated.View layout={LinearTransition.springify().damping(18)} style={styles.stage}>
              <PressableScale
                onPress={listening ? speech.stop : listen}
                disabled={phase.name === "thinking" || phase.name === "review"}
                pressedScale={0.95}
                accessibilityRole="button"
                accessibilityLabel={listening ? t("voiceExpense.stop") : t("voiceExpense.speakToAdd")}
                style={{ width: orbSize, height: orbSize }}
              >
                <VoiceOrb size={orbSize} mode={orbMode} level={speech.volume} isDark={isDark} discColor={c.card} />
                <View style={styles.orbIcon} pointerEvents="none">
                  <Icon
                    name={phase.name === "saved" ? "check" : listening ? "pause" : "mic"}
                    size={compact ? 22 : 30}
                    color={isDark ? "#FFFFFF" : c.text}
                    strokeWidth={phase.name === "saved" ? 2.6 : 2}
                  />
                </View>
              </PressableScale>

              <PrivateView style={styles.words}>
                {status ? <Text style={[styles.status, { color: c.text, fontFamily: f.semibold }]}>{status}</Text> : null}
                {heard ? (
                  <Animated.Text entering={FadeIn.duration(160)} style={[styles.heard, { color: c.textSoft, fontFamily: f.regular }]}>
                    “{heard}”
                  </Animated.Text>
                ) : null}
              </PrivateView>
            </Animated.View>

            {phase.name === "review" && draft ? (
              <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(150)}>
                <PrivateView>
                  <VoiceDraftCard
                    key={draft.transcript}
                    draft={draft}
                    shares={shares}
                    tripName={trip?.name ?? null}
                    canAddPeople={trip !== null && !locked}
                    onAddPerson={addPerson}
                    onLeaveOut={(name) => updateDraft(replaceDraftPerson(draft, name, null))}
                    onSave={saveDraft}
                    onEdit={draft.kind === "expense" ? () => setEditing(true) : undefined}
                    onRetry={listen}
                  />
                </PrivateView>
              </Animated.View>
            ) : phase.name === "saved" ? (
              <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.savedActions}>
                <AuraButton label={t("voiceExpense.addAnother")} icon="mic" variant="secondary" onPress={listen} style={styles.flex} />
                <AuraButton label={t("voiceExpense.done")} onPress={close} style={styles.flex} />
              </Animated.View>
            ) : speech.state.status === "unavailable" ? (
              <SpeechProblem reason={speech.state.reason} locale={speech.state.locale} onDownload={speech.downloadLanguage} />
            ) : phase.name === "idle" && !listening ? (
              <Animated.View entering={FadeIn.duration(300)} style={styles.examples}>
                <Text style={[styles.examplesLabel, { color: c.textMuted, fontFamily: f.medium }]}>{t("voiceExpense.try")}</Text>
                {[t("voiceExpense.example1"), t("voiceExpense.example2"), t("voiceExpense.example3")].map((example) => (
                  <Text key={example} style={[styles.example, { color: c.textSoft, fontFamily: f.regular }]}>
                    {example}
                  </Text>
                ))}
              </Animated.View>
            ) : null}
          </>
        )}

        <View style={styles.spacer} />
        <View style={styles.privacy}>
          <Icon name="lock" size={12} color={c.textMuted} />
          <Text style={[styles.privacyText, { color: c.textMuted, fontFamily: f.regular }]}>
            {onlineName ? t("voiceExpense.privacyOnline", { provider: onlineName }) : t("voiceExpense.privacy")}
          </Text>
        </View>
      </ScrollView>

      <AuraSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t("voiceExpense.chooseTrip")}>
        <ScrollView contentContainerStyle={styles.pickerList}>
          {trips.map((entry) => {
            const active = entry.id === tripId;
            return (
              <PressableScale
                key={entry.id}
                haptic={false}
                pressedScale={0.98}
                onPress={() => selectTrip(entry.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.pickerRow, { backgroundColor: active ? c.surfaceStrong : "transparent" }]}
              >
                <Text style={[styles.pickerName, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                  {entry.name}
                </Text>
                {entry.id === activeTripId ? (
                  <Text style={[styles.pickerBadge, { color: c.textMuted, fontFamily: f.medium }]}>{t("voiceExpense.activeTrip")}</Text>
                ) : null}
                {active ? <Icon name="check" size={16} color={c.text} strokeWidth={2.4} /> : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      </AuraSheet>

      {draft?.kind === "expense" ? (
        <ExpenseForm
          visible={editing}
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
      ) : null}
    </View>
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
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  return (
    <AuraCard tone={auraStatusAccent.live} style={styles.problem}>
      <Text style={[styles.cardBody, { color: c.text, fontFamily: f.regular }]}>{t(`voiceExpense.speech.${reason}`)}</Text>
      {reason === "permission" ? (
        <AuraButton
          label={t("safety.openSettings")}
          icon="settings"
          variant="secondary"
          size="md"
          onPress={() => void Linking.openSettings()}
          style={styles.start}
        />
      ) : null}
      {reason === "language-missing" && locale && process.env.EXPO_OS === "android" ? (
        downloadStatus ? (
          <Text style={[styles.cardBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("voiceExpense.speech.downloadStarted")}</Text>
        ) : (
          <AuraButton
            label={t("voiceExpense.speech.download")}
            icon="download"
            variant="secondary"
            size="md"
            onPress={async () => setDownloadStatus((await onDownload(locale)) ?? "failed")}
            style={styles.start}
          />
        )
      ) : null}
    </AuraCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  needsModel: { marginTop: 40, gap: 8 },
  cardTitle: { fontSize: 17 },
  cardBody: { fontSize: 14, lineHeight: 20 },
  start: { alignSelf: "flex-start", marginTop: 6 },
  stage: { alignItems: "center", marginTop: 28, marginBottom: 20 },
  orbIcon: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  words: { alignItems: "center", marginTop: 18, paddingHorizontal: 8, gap: 8 },
  status: { fontSize: 20, letterSpacing: -0.4, textAlign: "center", lineHeight: 26 },
  heard: { fontSize: 15.5, lineHeight: 22, textAlign: "center" },
  savedActions: { flexDirection: "row", gap: 10 },
  problem: { gap: 10 },
  examples: { alignItems: "center", gap: 6 },
  examplesLabel: { fontSize: 13, marginBottom: 2 },
  example: { fontSize: 14.5, lineHeight: 20, textAlign: "center" },
  spacer: { flex: 1, minHeight: 24 },
  privacy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12 },
  privacyText: { fontSize: 12, textAlign: "center", flexShrink: 1 },
  pickerList: { paddingHorizontal: 12, paddingBottom: 12 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
  pickerName: { flex: 1, fontSize: 16 },
  pickerBadge: { fontSize: 12.5 },
});
