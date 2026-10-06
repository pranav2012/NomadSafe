import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuraButton, AuraSegmented, AuraSheet, Icon, PressableScale, useAura } from "@/atoms";
import { auraCategoryColors, auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { EXPENSE_CATEGORIES } from "@/features/expenses/constants/categories";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  buildImportCandidates,
  candidateToInput,
  splitPastedMessages,
  type ImportCandidate,
} from "@/features/expenses/services/importPipeline";
import { importErrorCode } from "@/features/expenses/services/importErrors";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import { useGmailProgressLabel } from "@/features/expenses/hooks/useGmailStatus";
import { syncTripGmail, type TripGmailSyncResult } from "@/features/expenses/services/tripGmailSync";
import type { Trip } from "@/features/trips/store/tripsStore";
import { track, PrivateView } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { showInterstitial } from "@/modules/ads";

type Tab = "paste" | "gmail";

export interface ImportSheetProps {
  visible: boolean;
  groupId: string | null;
  initialTab?: Tab;
  trip: Trip | null;
  onClose: () => void;
  onImported: (count: number) => void;
  /** Opens the Splitwise / Settle Up import for this trip or group. */
  onFromApp?: () => void;
}

/** Paste or Gmail import in a full-height sheet: pick a source, review the parsed spends, import. */
export function ImportSheet({ visible, onClose, ...props }: ImportSheetProps) {
  const { t } = useLocalization();
  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("expenses.importHeading")} full>
      <ImportBody onClose={onClose} {...props} />
    </AuraSheet>
  );
}

function ImportBody({ groupId, trip, initialTab = "paste", onImported, onFromApp }: Omit<ImportSheetProps, "visible">) {
  const { c, f } = useAura();
  const { t, formatCurrency, locale } = useLocalization();
  const addExpenses = useExpensesStore((state) => state.addExpenses);
  const gmail = useGmailImport();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [pasted, setPasted] = useState("");
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [gmailResult, setGmailResult] = useState<TripGmailSyncResult | null>(null);
  const progressLabel = useGmailProgressLabel(trip?.id);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoScannedRef = useRef(false);
  const submittingRef = useRef(false);

  // Gmail spends are added by the trip sync itself; only pasted alerts go through review.
  const scanGmail = async () => {
    if (!trip) {
      setError(t("expenses.gmailNeedsTrip"));
      return;
    }
    setIsWorking(true);
    setError(null);
    setGmailResult(null);
    try {
      setGmailResult(await syncTripGmail(trip));
    } catch (err) {
      setError(t(`expenses.importErrors.${importErrorCode(err)}`));
    } finally {
      setIsWorking(false);
    }
  };

  // Once Gmail finishes connecting, scan automatically — no second tap needed.
  useEffect(() => {
    // A dropped grant flips back to "Connect"; scan again once it reconnects.
    if (!gmail.connected) autoScannedRef.current = false;
    if (tab === "gmail" && gmail.connected && !autoScannedRef.current && candidates === null && !isWorking) {
      autoScannedRef.current = true;
      void scanGmail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, gmail.connected]);

  const handleParsePaste = async () => {
    setIsWorking(true);
    setError(null);
    try {
      setCandidates(await buildImportCandidates(splitPastedMessages(pasted), "paste", { trip }));
    } catch (err) {
      logger.warn("expense-import", "failed", err);
      setError(t(`expenses.importErrors.${importErrorCode(err)}`));
    } finally {
      setIsWorking(false);
    }
  };

  const handleScanGmail = async () => {
    if (!gmail.configured) {
      setError(t("expenses.gmailNotConfigured"));
      return;
    }
    if (!gmail.connected) {
      await gmail.connect();
      return;
    }
    await scanGmail();
  };

  const toggleCandidate = (id: string) => {
    setCandidates((current) =>
      current?.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item,
      ) ?? null,
    );
  };

  const cycleCategory = (id: string) => {
    setCandidates((current) =>
      current?.map((item) => {
        if (item.id !== id) return item;
        const index = EXPENSE_CATEGORIES.findIndex((meta) => meta.id === item.category);
        const next = EXPENSE_CATEGORIES[(index + 1) % EXPENSE_CATEGORIES.length].id;
        return { ...item, category: next };
      }) ?? null,
    );
  };

  const handleConfirm = async () => {
    if (!candidates || submittingRef.current) return;
    const selected = candidates.filter((item) => item.selected);
    if (selected.length === 0) {
      setError(t("expenses.nothingSelected"));
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const inputs = await Promise.all(
        selected.map((item) => candidateToInput(item, groupId, trip?.currency)),
      );
      const added = addExpenses(inputs);
      track("expense_added", { source: "paste", count: added.length });
      onImported(added.length);
      if (added.length > 0) showInterstitial("expenses_imported");
    } catch (err) {
      logger.warn("expense-import", "confirm failed", err);
      setError(t(`expenses.importErrors.${importErrorCode(err)}`));
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const selectedCount = candidates?.filter((item) => item.selected).length ?? 0;

  return (
    <PrivateView style={styles.root}>
      {candidates === null ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {onFromApp && groupId ? (
            <PressableScale onPress={onFromApp} pressedScale={0.98} accessibilityRole="button" style={[styles.fromApp, { backgroundColor: c.surface, borderColor: c.hairline }]}>
              <Icon name="swap" size={16} color={c.text} />
              <View style={styles.fromAppText}>
                <Text style={[styles.fromAppTitle, { color: c.text, fontFamily: f.medium }]}>{t("importApp.entry")}</Text>
                <Text style={[styles.fromAppDetail, { color: c.textMuted, fontFamily: f.regular }]}>{t("importApp.entryDetail")}</Text>
              </View>
              <Icon name="chevronRight" size={14} color={c.textMuted} />
            </PressableScale>
          ) : null}
          <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t("expenses.importIntro")}</Text>
          <AuraSegmented
            options={[
              { value: "paste", label: t("expenses.sourcePaste") },
              { value: "gmail", label: t("expenses.sourceGmailTab") },
            ]}
            value={tab}
            onChange={(next) => {
              setTab(next);
              setError(null);
            }}
          />

          {tab === "paste" ? (
            <>
              <TextInput
                value={pasted}
                onChangeText={setPasted}
                placeholder={t("expenses.pastePlaceholder")}
                placeholderTextColor={c.textMuted}
                multiline
                style={[styles.textArea, { color: c.text, backgroundColor: c.surface, borderColor: c.hairline, fontFamily: f.regular }]}
              />
              <AuraButton
                label={t("expenses.parseAction")}
                icon="search"
                disabled={pasted.trim().length === 0 || isWorking}
                loading={isWorking}
                onPress={handleParsePaste}
              />
            </>
          ) : (
            <>
              <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>
                {!gmail.configured
                  ? t("expenses.gmailNotConfigured")
                  : gmail.connected
                    ? gmail.accountEmail
                      ? t("expenses.gmailConnectedAs", { email: gmail.accountEmail })
                      : t("expenses.gmailConnected")
                    : t("expenses.gmailConnect")}
              </Text>
              <AuraButton
                label={gmail.connected ? t("expenses.gmailFetch") : t("expenses.gmailConnect")}
                icon="mail"
                disabled={!gmail.configured || !gmail.ready || isWorking}
                loading={isWorking}
                onPress={handleScanGmail}
              />
              {isWorking || gmailResult ? (
                <Text style={[styles.progress, { color: c.textSoft, fontFamily: f.medium }]} accessibilityLiveRegion="polite">
                  {isWorking
                    ? (progressLabel ?? t("expenses.gmailSearching"))
                    : gmailResult && gmailResult.expensesAdded > 0
                      ? t("expenses.autoSynced", { count: gmailResult.expensesAdded })
                      : t("expenses.gmailUpToDate")}
                </Text>
              ) : null}
            </>
          )}

          {error ? <Text style={[styles.error, { fontFamily: f.medium }]}>{error}</Text> : null}
        </ScrollView>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>
              {candidates.length === 0
                ? t("expenses.reviewNone")
                : t("expenses.reviewSubtitle", { count: candidates.length, selected: selectedCount })}
            </Text>

            {candidates.map((candidate) => {
              const tone = auraCategoryColors[candidate.category];
              const details = [
                new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(candidate.date)),
                candidate.viaModel ? t("expenses.viaModel") : null,
                candidate.duplicate ? t("expenses.duplicate") : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <PressableScale
                  key={candidate.id}
                  haptic={false}
                  pressedScale={0.98}
                  onPress={() => toggleCandidate(candidate.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: candidate.selected }}
                  style={[
                    styles.candidate,
                    { backgroundColor: c.surface, borderColor: candidate.selected ? c.textSoft : c.hairline, opacity: candidate.selected ? 1 : 0.55 },
                  ]}
                >
                  <View style={[styles.checkbox, { backgroundColor: candidate.selected ? c.inverse : "transparent", borderColor: candidate.selected ? c.inverse : c.textMuted }]}>
                    {candidate.selected ? <Icon name="check" size={12} color={c.onInverse} strokeWidth={3} /> : null}
                  </View>
                  <View style={styles.candidateBody}>
                    <Text style={[styles.merchant, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                      {candidate.merchant || t("expenses.empty")}
                    </Text>
                    <View style={styles.metaRow}>
                      <PressableScale onPress={() => cycleCategory(candidate.id)} hitSlop={6} style={[styles.tag, { backgroundColor: `${tone}1F` }]}>
                        <View style={[styles.dot, { backgroundColor: tone }]} />
                        <Text style={[styles.tagText, { color: c.text, fontFamily: f.medium }]}>{t(`expenses.category.${candidate.category}`)}</Text>
                      </PressableScale>
                      <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
                        {details}
                      </Text>
                    </View>
                    {candidate.preview ? (
                      <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={2}>
                        {candidate.preview}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>
                    {formatCurrency(candidate.amount, candidate.currency, {})}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          {error ? <Text style={[styles.error, styles.footerError, { fontFamily: f.medium }]}>{error}</Text> : null}
          <View style={styles.footer}>
            <PressableScale
              onPress={() => {
                setCandidates(null);
                setError(null);
              }}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              style={[styles.back, { backgroundColor: c.surfaceStrong }]}
            >
              <Icon name="chevronLeft" size={18} color={c.text} />
            </PressableScale>
            <AuraButton
              label={t("expenses.importSelected", { count: selectedCount })}
              icon="download"
              disabled={selectedCount === 0 || isSubmitting}
              loading={isSubmitting}
              onPress={handleConfirm}
              style={styles.flex}
            />
          </View>
        </>
      )}
    </PrivateView>
  );
}

const styles = StyleSheet.create({
  fromApp: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  fromAppText: { flex: 1, gap: 2 },
  fromAppTitle: { fontSize: 14.5 },
  fromAppDetail: { fontSize: 12.5 },
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 14 },
  intro: { fontSize: 14, lineHeight: 20 },
  progress: { fontSize: 13, textAlign: "center", fontVariant: ["tabular-nums"] },
  textArea: { minHeight: 160, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, fontSize: 14.5, lineHeight: 20, textAlignVertical: "top" },
  error: { color: auraStatusAccent.alert, fontSize: 13, lineHeight: 18 },
  footerError: { paddingHorizontal: 20, paddingBottom: 6 },
  candidate: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  candidateBody: { flex: 1, gap: 5 },
  merchant: { fontSize: 15 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { fontSize: 12 },
  meta: { fontSize: 12, flexShrink: 1 },
  amount: { fontSize: 15, fontVariant: ["tabular-nums"] },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
  back: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
});
