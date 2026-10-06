import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { AuraListGroup, AuraListRow, AuraSheet, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import type { Expense } from "@/features/expenses/store/expensesStore";
import { exportSpends, type ExportFormat } from "@/features/expenses/services/moneyExport";

/** Picks CSV or PDF for the spends on screen (Plus) and hands the file to the share sheet. */
export function ExportSheet({ visible, onClose, expenses, title }: { visible: boolean; onClose: () => void; expenses: Expense[]; title: string }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [busy, setBusy] = useState(false);

  const run = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      const shared = await exportSpends(expenses, title, format);
      if (!shared) showAlert(t("export.unavailable"));
      else track("money_exported", { format, count: expenses.length });
      onClose();
    } catch {
      showAlert(t("export.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuraSheet visible={visible} onClose={onClose} title={t("export.title")} subtitle={title}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.intro, { color: c.textSoft, fontFamily: f.regular }]}>{t("export.intro", { count: expenses.length })}</Text>
        <AuraListGroup>
          <AuraListRow icon="copy" label={t("export.csv")} detail={t("export.csvDetail")} onPress={() => void run("csv")} />
          <AuraListRow icon="receipt" label={t("export.pdf")} detail={t("export.pdfDetail")} onPress={() => void run("pdf")} />
        </AuraListGroup>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  intro: { fontSize: 14.5, lineHeight: 21 },
});
