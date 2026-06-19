import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import {
  EXPENSE_CATEGORIES,
  getCategoryMeta,
} from "@/features/expenses/constants/categories";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  buildImportCandidates,
  candidateToInput,
  splitPastedMessages,
  type ImportCandidate,
} from "@/features/expenses/services/importPipeline";
import { smsImport } from "@/features/expenses/services/smsImport";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import type { ExpenseSource } from "@/features/expenses/store/expensesStore";
import type { Trip } from "@/features/trips/store/tripsStore";

type Tab = "paste" | "sms" | "gmail";

export interface ImportSheetProps {
  tripId: string | null;
  trip: Trip | null;
  onClose: () => void;
  onImported: (count: number) => void;
}

export function ImportSheet({ tripId, trip, onClose, onImported }: ImportSheetProps) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, formatCurrency, locale } = useLocalization();
  const addExpenses = useExpensesStore((state) => state.addExpenses);
  const gmail = useGmailImport();

  const [tab, setTab] = useState<Tab>("paste");
  const [pasted, setPasted] = useState("");
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoScannedRef = useRef(false);

  const runImport = async (loader: () => Promise<{ body: string; date?: string }[]>, source: ExpenseSource) => {
    setIsWorking(true);
    setError(null);
    try {
      const messages = await loader();
      const result = await buildImportCandidates(messages, source, { trip });
      setCandidates(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  // Once Gmail finishes connecting, scan automatically — no second tap needed.
  useEffect(() => {
    if (tab === "gmail" && gmail.connected && !autoScannedRef.current && candidates === null && !isWorking) {
      autoScannedRef.current = true;
      runImport(async () => {
        const messages = await gmail.fetchEmails();
        await gmail.completeSync();
        return messages;
      }, "email");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, gmail.connected]);

  const handleParsePaste = () =>
    runImport(async () => splitPastedMessages(pasted), "manual");

  const handleScanSms = async () => {
    if (!smsImport.isSupported()) {
      setError(t("expenses.smsUnsupported"));
      return;
    }
    const status = smsImport.getPermissionStatus();
    if (status !== "granted") {
      const granted = await smsImport.requestPermission();
      if (!granted) {
        setError(t("expenses.smsPermissionDenied"));
        return;
      }
    }
    runImport(() => smsImport.readRecent(), "sms");
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
    await runImport(async () => {
      const messages = await gmail.fetchEmails();
      await gmail.completeSync();
      return messages;
    }, "email");
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
    if (!candidates) return;
    const selected = candidates.filter((item) => item.selected);
    if (selected.length === 0) {
      setError(t("expenses.nothingSelected"));
      return;
    }
    const inputs = await Promise.all(
      selected.map((item) => candidateToInput(item, tripId, trip?.currency)),
    );
    addExpenses(inputs);
    onImported(selected.length);
  };

  const selectedCount = candidates?.filter((item) => item.selected).length ?? 0;

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>{t("expenses.importEyebrow")}</Text>
          <Text style={[styles.title, { color: theme.inkDeep }]}>{t("expenses.importHeading")}</Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={[styles.closeButton, { backgroundColor: theme.paper, borderColor: theme.hairline }]}
        >
          <Icon name="x" size={18} color={theme.inkSoft} />
        </Pressable>
      </View>

      {candidates === null ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: theme.inkSoft }]}>{t("expenses.importIntro")}</Text>

          <View style={[styles.tabBar, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
            {(["paste", "sms", "gmail"] as Tab[]).map((option) => {
              const active = tab === option;
              const label =
                option === "paste"
                  ? t("expenses.sourcePaste")
                  : option === "sms"
                    ? t("expenses.sourceSmsTab")
                    : t("expenses.sourceGmailTab");
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setTab(option);
                    setError(null);
                  }}
                  style={[styles.tab, active && { backgroundColor: theme.tealSoft }]}
                >
                  <Text style={[styles.tabText, { color: active ? theme.teal : theme.inkSoft }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === "paste" ? (
            <View style={styles.group}>
              <View style={[styles.textArea, { backgroundColor: theme.paper, borderColor: theme.hairline }]}>
                <TextInput
                  value={pasted}
                  onChangeText={setPasted}
                  placeholder={t("expenses.pastePlaceholder")}
                  placeholderTextColor={theme.inkMuted}
                  multiline
                  style={[styles.textInput, { color: theme.inkDeep }]}
                />
              </View>
              <PrimaryButton
                label={t("expenses.parseAction")}
                icon="search"
                disabled={pasted.trim().length === 0 || isWorking}
                loading={isWorking}
                onPress={handleParsePaste}
                theme={theme}
              />
            </View>
          ) : null}

          {tab === "sms" ? (
            <View style={styles.group}>
              <Text style={[styles.sourceHint, { color: theme.inkSoft }]}>
                {smsImport.isSupported() ? t("expenses.smsPermissionNeeded") : t("expenses.smsUnsupported")}
              </Text>
              <PrimaryButton
                label={t("expenses.scanSms")}
                icon="messageCircle"
                disabled={!smsImport.isSupported() || isWorking}
                loading={isWorking}
                onPress={handleScanSms}
                theme={theme}
              />
            </View>
          ) : null}

          {tab === "gmail" ? (
            <View style={styles.group}>
              <Text style={[styles.sourceHint, { color: theme.inkSoft }]}>
                {!gmail.configured
                  ? t("expenses.gmailNotConfigured")
                  : gmail.connected
                    ? t("expenses.gmailConnected")
                    : t("expenses.gmailConnect")}
              </Text>
              <PrimaryButton
                label={gmail.connected ? t("expenses.gmailFetch") : t("expenses.gmailConnect")}
                icon="mail"
                disabled={!gmail.configured || !gmail.ready || isWorking}
                loading={isWorking}
                onPress={handleScanGmail}
                theme={theme}
              />
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: theme.stamp }]}>{error}</Text> : null}
        </ScrollView>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.reviewSubtitle, { color: theme.inkSoft }]}>
              {candidates.length === 0
                ? t("expenses.reviewNone")
                : t("expenses.reviewSubtitle", { count: candidates.length, selected: selectedCount })}
            </Text>

            {candidates.map((candidate) => {
              const meta = getCategoryMeta(candidate.category);
              const color = theme[meta.color];
              return (
                <Pressable
                  key={candidate.id}
                  onPress={() => toggleCandidate(candidate.id)}
                  style={[
                    styles.candidate,
                    {
                      backgroundColor: theme.paperSoft,
                      borderColor: candidate.selected ? theme.teal : theme.hairline,
                      opacity: candidate.selected ? 1 : 0.6,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: candidate.selected ? theme.teal : "transparent",
                        borderColor: candidate.selected ? theme.teal : theme.hairline,
                      },
                    ]}
                  >
                    {candidate.selected ? <Icon name="check" size={12} color={theme.inverse} strokeWidth={3} /> : null}
                  </View>
                  <View style={styles.candidateBody}>
                    <Text style={[styles.candidateMerchant, { color: theme.inkDeep }]} numberOfLines={1}>
                      {candidate.merchant || t("expenses.empty")}
                    </Text>
                    <View style={styles.candidateMetaRow}>
                      <Pressable onPress={() => cycleCategory(candidate.id)} hitSlop={6} style={styles.categoryTag}>
                        <View style={[styles.categoryDot, { backgroundColor: color }]} />
                        <Text style={[styles.categoryTagText, { color }]}>
                          {t(`expenses.category.${candidate.category}`)}
                        </Text>
                      </Pressable>
                      <Text style={[styles.candidateDate, { color: theme.inkSoft }]}>
                        {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
                          new Date(candidate.date),
                        )}
                      </Text>
                      {candidate.viaModel ? (
                        <View style={[styles.badge, { backgroundColor: theme.mustardSoft }]}>
                          <Text style={[styles.badgeText, { color: theme.mustard }]}>{t("expenses.viaModel")}</Text>
                        </View>
                      ) : null}
                      {candidate.duplicate ? (
                        <Text style={[styles.duplicate, { color: theme.inkMuted }]}>{t("expenses.duplicate")}</Text>
                      ) : null}
                    </View>
                    {candidate.preview ? (
                      <Text style={[styles.candidatePreview, { color: theme.inkMuted }]} numberOfLines={2}>
                        {candidate.preview}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.candidateAmount, { color: theme.inkDeep }]}>
                    {formatCurrency(candidate.amount, candidate.currency)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.hairline, backgroundColor: theme.paper }]}>
            <Pressable
              onPress={() => {
                setCandidates(null);
                setError(null);
              }}
              style={[styles.backButton, { borderColor: theme.hairline }]}
            >
              <Icon name="chevronLeft" size={16} color={theme.inkSoft} />
            </Pressable>
            <PrimaryButton
              label={t("expenses.importSelected", { count: selectedCount })}
              icon="download"
              disabled={selectedCount === 0}
              loading={false}
              onPress={handleConfirm}
              theme={theme}
              fill
            />
          </View>
          {error ? <Text style={[styles.error, { color: theme.stamp, paddingHorizontal: 16 }]}>{error}</Text> : null}
        </>
      )}
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  disabled,
  loading,
  onPress,
  theme,
  fill,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  fill?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        fill && { flex: 1 },
        { backgroundColor: theme.teal, opacity: disabled ? 0.45 : pressed ? 0.9 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.inverse} />
      ) : (
        <Icon name={icon} size={17} color={theme.inverse} />
      )}
      <Text style={[styles.primaryButtonText, { color: theme.inverse }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: { fontFamily: NOMAD_FONTS.display, fontSize: 30, lineHeight: 34, marginTop: 4 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 14 },
  intro: { fontFamily: NOMAD_FONTS.ui, fontSize: 13.5, lineHeight: 20 },
  tabBar: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10 },
  tabText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 13 },
  group: { gap: 12 },
  textArea: { borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 150 },
  textInput: { fontFamily: NOMAD_FONTS.ui, fontSize: 14, lineHeight: 20, minHeight: 130, textAlignVertical: "top" },
  sourceHint: { fontFamily: NOMAD_FONTS.ui, fontSize: 13, lineHeight: 19 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryButtonText: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  error: { fontFamily: NOMAD_FONTS.ui, fontSize: 12.5, lineHeight: 18 },
  reviewSubtitle: { fontFamily: NOMAD_FONTS.ui, fontSize: 13, lineHeight: 18 },
  candidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  candidateBody: { flex: 1, gap: 4 },
  candidateMerchant: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 14 },
  candidateMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  categoryTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  categoryDot: { width: 7, height: 7, borderRadius: 999 },
  categoryTagText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  badge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  duplicate: { fontFamily: NOMAD_FONTS.ui, fontSize: 11 },
  candidateDate: { fontFamily: NOMAD_FONTS.ui, fontSize: 11 },
  candidatePreview: { fontFamily: NOMAD_FONTS.ui, fontSize: 11, lineHeight: 15 },
  candidateAmount: { fontFamily: NOMAD_FONTS.monoMedium, fontSize: 14 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
