import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { AuraButton, AuraChip, AuraField, AuraSegmented, AuraSheet, Icon, PressableScale, showAlert, showToast, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { showInterstitial } from "@/modules/ads";
import { withSystemPrompt } from "@/utils/systemPrompt";
import { findMoneyGroup, isTrip, useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { categorizeHeuristic } from "@/features/expenses/services/categorizer";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney } from "@/features/expenses/utils/money";
import { SELF_ID } from "@/features/expenses/utils/split";
import { base64ToBytes, decodeBytes, importBalances, matchesTotals, parseImport, type ParsedImport } from "@/features/expenses/utils/importFormats";
import { buildImport, type ImportMode } from "@/features/expenses/utils/importBuild";

type Step = "pick" | "me" | "people" | "preview";
const NEW = "__new__";
// Exports round each share, which can leave a few paise/cents per person.
const ROUNDING = 0.05;

/** Imports a Splitwise or Settle Up export into a group (or a new one), read on the phone. */
export function ImportFromAppSheet({ visible, groupId, onClose, onDone }: { visible: boolean; groupId: string | null; onClose: () => void; onDone: (groupId: string) => void }) {
  const { t } = useLocalization();
  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("importApp.title")} full>
      {visible ? <ImportBody groupId={groupId} onClose={onClose} onDone={onDone} /> : null}
    </AuraSheet>
  );
}

function ImportBody({ groupId, onClose, onDone }: { groupId: string | null; onClose: () => void; onDone: (groupId: string) => void }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const group = useTripsStore((state) => findMoneyGroup(state, groupId));
  const [step, setStep] = useState<Step>("pick");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [me, setMe] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ImportMode>("history");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const companions = group?.companions ?? [];
  const others = useMemo(() => (parsed ? parsed.people.filter((person) => person !== me) : []), [parsed, me]);
  const appName = parsed?.source === "settleup" ? "Settle Up" : "Splitwise";

  const pickFile = async () => {
    const result = await withSystemPrompt(() => DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true }));
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const next = parseImport(decodeBytes(base64ToBytes(base64)));
      if (!next || next.rows.length === 0) {
        showAlert(t("importApp.notExportTitle"), t("importApp.notExportBody"));
        return;
      }
      setParsed(next);
      setFileName(asset.name.replace(/\.(csv|txt)$/i, ""));
      setName(asset.name.replace(/\.(csv|txt)$/i, "").replace(/[_-]+/g, " ").trim());
      setStep("me");
    } catch {
      showAlert(t("importApp.notExportTitle"), t("importApp.notExportBody"));
    }
  };

  const chooseMe = (person: string) => {
    setMe(person);
    const defaults: Record<string, string> = {};
    for (const other of parsed?.people ?? []) {
      if (other === person) continue;
      const first = other.split(" ")[0].toLowerCase();
      const match = companions.find((name) => name.toLowerCase() === other.toLowerCase()) ?? companions.find((name) => name.split(" ")[0].toLowerCase() === first);
      defaults[other] = match ?? NEW;
    }
    setMapping(defaults);
    setStep(Object.keys(defaults).length > 0 ? "people" : "preview");
  };

  const people = useMemo(() => {
    const out: Record<string, string> = {};
    if (me) out[me] = SELF_ID;
    for (const other of others) out[other] = mapping[other] && mapping[other] !== NEW ? mapping[other] : other;
    return out;
  }, [me, others, mapping]);

  const balances = useMemo(() => (parsed ? importBalances(parsed.rows) : {}), [parsed]);
  const counts = parsed
    ? {
        expenses: parsed.rows.filter((row) => row.kind === "expense").length,
        payments: parsed.rows.filter((row) => row.kind === "payment").length,
        estimated: parsed.rows.filter((row) => row.estimated).length,
        personal: parsed.rows.filter((row) => row.kind === "personal"),
        first: parsed.rows.map((row) => row.date).sort()[0] ?? "",
        last: parsed.rows.map((row) => row.date).sort().at(-1) ?? "",
      }
    : null;
  const matches = parsed?.totals ? matchesTotals(parsed.rows, parsed.totals) : null;
  const mainCurrency = useMemo(() => {
    const tally = new Map<string, number>();
    for (const row of parsed?.rows ?? []) tally.set(row.currency, (tally.get(row.currency) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  }, [parsed]);

  const runImport = () => {
    if (!parsed || !me || busy) return;
    setBusy(true);
    try {
      const newPeople = others.filter((other) => !mapping[other] || mapping[other] === NEW);
      let targetId = groupId;
      if (!targetId) {
        const created = useTripsStore.getState().createGroup({ name: name.trim() || fileName || appName, emoji: "📥", currency: mainCurrency, companions: newPeople });
        track("group_created", { people: newPeople.length + 1 });
        targetId = created.id;
      } else if (group) {
        const companionsNext = [...group.companions, ...newPeople.filter((person) => !group.companions.includes(person))];
        if (isTrip(group)) useTripsStore.getState().updateTrip(group.id, { companions: companionsNext, mode: companionsNext.length > 0 ? "group" : group.mode });
        else useTripsStore.getState().updateGroup(group.id, { companions: companionsNext });
      }
      const built = buildImport(parsed, {
        mode,
        people,
        mine,
        categorize: (description) => categorizeHeuristic({ merchant: description }).category,
        carriedOver: t("importApp.carriedOver", { app: appName }),
        today: toLocalDayKey(new Date().toISOString()),
      });
      const store = useExpensesStore.getState();
      const added = store.addExpenses(built.expenses.map((expense) => ({ ...expense, groupId: targetId, source: "import" as const })));
      const known = new Set(store.settlements.map((settlement) => settlement.externalId).filter(Boolean));
      const payments = store.addSettlements(
        built.settlements
          .filter((settlement) => !known.has(settlement.externalId) && settlement.from !== settlement.to)
          .map((settlement) => ({ ...settlement, groupId: targetId!, source: "import" as const })),
      ).length;
      track("app_import_completed", { source: parsed.source, mode, expenses: added.length, payments });
      onClose();
      onDone(targetId!);
      showToast(t("importApp.done", { count: added.length + payments }), t("importApp.doneBody"));
      showInterstitial("expenses_imported");
    } finally {
      setBusy(false);
    }
  };

  const label = (text: string) => <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{text}</Text>;
  const body = (text: string) => <Text style={[styles.body, { color: c.textSoft, fontFamily: f.regular }]}>{text}</Text>;
  const money = (amount: number, currency: string) => formatMoney(formatCurrency, amount, currency);
  const personName = (person: string) => (person === me ? t("split.you") : mapping[person] && mapping[person] !== NEW ? mapping[person] : person);

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === "pick" ? (
          <>
            {body(t("importApp.intro"))}
            <View style={[styles.steps, { backgroundColor: c.surface, borderColor: c.hairline }]}>
              <Text style={[styles.stepText, { color: c.text, fontFamily: f.regular }]}>{t("importApp.howSplitwise")}</Text>
              <Text style={[styles.stepText, { color: c.text, fontFamily: f.regular }]}>{t("importApp.howSettleUp")}</Text>
            </View>
            {body(t("importApp.privacy"))}
          </>
        ) : null}

        {step === "me" && parsed ? (
          <>
            {label(t("importApp.whichYou", { app: appName }))}
            <View style={styles.chips}>
              {parsed.people.map((person) => (
                <AuraChip key={person} label={person} selected={me === person} onPress={() => chooseMe(person)} />
              ))}
            </View>
          </>
        ) : null}

        {step === "people" && parsed ? (
          <>
            {body(t("importApp.matchIntro"))}
            {others.map((other) => (
              <View key={other} style={styles.match}>
                <Text style={[styles.matchName, { color: c.text, fontFamily: f.semibold }]}>
                  {other}
                  {parsed.former.includes(other) ? ` · ${t("importApp.former")}` : ""}
                </Text>
                <View style={styles.chips}>
                  <AuraChip label={t("importApp.newPerson")} icon="plus" selected={mapping[other] === NEW} onPress={() => setMapping({ ...mapping, [other]: NEW })} />
                  {companions.map((name) => (
                    <AuraChip key={name} label={name} selected={mapping[other] === name} onPress={() => setMapping({ ...mapping, [other]: name })} />
                  ))}
                </View>
              </View>
            ))}
          </>
        ) : null}

        {step === "preview" && parsed && counts ? (
          <>
            <View style={[styles.summary, { backgroundColor: c.surface, borderColor: c.hairline }]}>
              <Text style={[styles.summaryTitle, { color: c.text, fontFamily: f.semibold }]}>
                {t("importApp.summary", { expenses: counts.expenses, payments: counts.payments })}
              </Text>
              {counts.first ? body(`${counts.first} – ${counts.last}`) : null}
              {matches !== null ? (
                <View style={styles.check}>
                  <Icon name={matches ? "check" : "alertTriangle"} size={15} color={matches ? "#3DDC97" : auraStatusAccent.live} />
                  <Text style={[styles.checkText, { color: matches ? "#3DDC97" : auraStatusAccent.live, fontFamily: f.medium }]}>
                    {matches ? t("importApp.matches", { app: appName }) : t("importApp.differs", { app: appName })}
                  </Text>
                </View>
              ) : null}
              {!Object.values(balances).some((byCurrency) => Object.values(byCurrency).some((value) => Math.abs(value) >= ROUNDING)) ? body(t("split.settled")) : null}
              {Object.entries(balances).map(([person, byCurrency]) =>
                Object.entries(byCurrency)
                  .filter(([, value]) => Math.abs(value) >= ROUNDING)
                  .map(([currency, value]) => (
                    <View key={`${person}-${currency}`} style={styles.balanceRow}>
                      <Text style={[styles.balanceName, { color: c.text, fontFamily: f.regular }]}>{personName(person)}</Text>
                      <Text style={[styles.balanceValue, { color: value > 0 ? "#3DDC97" : auraStatusAccent.alert, fontFamily: f.semibold }]}>
                        {value > 0 ? t("importApp.isOwed", { amount: money(value, currency) }) : t("importApp.owes", { amount: money(-value, currency) })}
                      </Text>
                    </View>
                  )),
              )}
              {counts.estimated > 0 ? body(t("importApp.estimated", { count: counts.estimated })) : null}
            </View>

            {label(t("importApp.bring"))}
            <AuraSegmented
              options={[
                { value: "history", label: t("importApp.history") },
                { value: "balances", label: t("importApp.balances") },
              ]}
              value={mode}
              onChange={setMode}
            />
            {body(mode === "history" ? t("importApp.historyBody") : t("importApp.balancesBody", { app: appName }))}

            {mode === "history" && counts.personal.length > 0 ? (
              <>
                {label(t("importApp.personalTitle"))}
                {body(t("importApp.personalBody", { app: appName }))}
                {counts.personal.map((row) => {
                  const selected = mine.has(row.key);
                  return (
                    <PressableScale
                      key={row.key}
                      haptic={false}
                      onPress={() => {
                        const next = new Set(mine);
                        if (selected) next.delete(row.key);
                        else next.add(row.key);
                        setMine(next);
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      style={styles.personal}
                    >
                      <Icon name={selected ? "check" : "plus"} size={15} color={selected ? c.text : c.textMuted} />
                      <Text style={[styles.personalText, { color: c.text, fontFamily: f.regular }]} numberOfLines={1}>
                        {row.description || "—"}
                      </Text>
                      <Text style={[styles.personalAmount, { color: c.textSoft, fontFamily: f.medium }]}>{money(row.amount, row.currency)}</Text>
                    </PressableScale>
                  );
                })}
              </>
            ) : null}

            {!groupId ? <AuraField label={t("money.groupName")} value={name} onChangeText={setName} placeholder={t("money.groupNamePlaceholder")} /> : null}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {step === "pick" ? <AuraButton label={t("importApp.choose")} icon="download" onPress={() => void pickFile()} style={styles.flex} /> : null}
        {step === "people" ? <AuraButton label={t("common.continue")} onPress={() => setStep("preview")} style={styles.flex} /> : null}
        {step === "preview" ? <AuraButton label={t("importApp.import")} icon="check" loading={busy} onPress={runImport} style={styles.flex} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  label: { fontSize: 13.5, marginTop: 4 },
  body: { fontSize: 14, lineHeight: 20 },
  steps: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  stepText: { fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  match: { gap: 8 },
  matchName: { fontSize: 15 },
  summary: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  summaryTitle: { fontSize: 16 },
  check: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkText: { fontSize: 14 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  balanceName: { fontSize: 14, flexShrink: 1 },
  balanceValue: { fontSize: 14, fontVariant: ["tabular-nums"] },
  personal: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  personalText: { flex: 1, fontSize: 14.5 },
  personalAmount: { fontSize: 14, fontVariant: ["tabular-nums"] },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10 },
});
