import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { translate } from "@/localization/translate";
import { logger } from "@/modules/logger";
import { selectMoneyGroups, useTripsStore } from "@/features/trips/store/tripsStore";
import type { Expense } from "@/features/expenses/store/expensesStore";
import { exportRows, toCsv, type ExportLabels } from "@/features/expenses/utils/exportRows";

export type ExportFormat = "csv" | "pdf";

function labels(): ExportLabels {
  return {
    you: translate("split.you"),
    notInGroup: translate("money.notInGroup"),
    headers: [
      translate("export.date"),
      translate("export.description"),
      translate("export.category"),
      translate("export.amount"),
      translate("export.currency"),
      translate("export.group"),
      translate("export.paidBy"),
      translate("export.yourShare"),
      translate("export.split"),
    ],
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

function fileName(title: string, extension: string) {
  const safe = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "nomadsafe";
  return `${safe}.${extension}`;
}

/**
 * Shares spends as a CSV or a PDF table through the system share sheet; the file is deleted after.
 * Returns false when sharing isn't available.
 */
export async function exportSpends(expenses: Expense[], title: string, format: ExportFormat): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const groups = selectMoneyGroups(useTripsStore.getState());
  const groupName = (id: string | null) => groups.find((group) => group.id === id)?.name ?? "";
  const head = labels();
  const rows = exportRows(expenses, groupName, head);
  let uri: string;
  if (format === "csv") {
    uri = `${FileSystem.cacheDirectory}${fileName(title, "csv")}`;
    await FileSystem.writeAsStringAsync(uri, `﻿${toCsv(rows, head.headers)}`);
  } else {
    const html = `<html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Roboto,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin:0 0 4px}p{color:#666;font-size:12px;margin:0 0 16px}
      table{border-collapse:collapse;width:100%;font-size:10px}
      th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
      th{background:#f4f4f6}</style></head><body>
      <h1>${escapeHtml(title)}</h1><p>${escapeHtml(translate("export.generated", { count: rows.length }))}</p>
      <table><thead><tr>${head.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      </body></html>`;
    // Loaded only when needed: builds made before expo-print was added don't have its native module.
    const Print = await import("expo-print");
    const printed = await Print.printToFileAsync({ html });
    uri = `${FileSystem.cacheDirectory}${fileName(title, "pdf")}`;
    await FileSystem.moveAsync({ from: printed.uri, to: uri });
  }
  try {
    await Sharing.shareAsync(uri, {
      mimeType: format === "csv" ? "text/csv" : "application/pdf",
      UTI: format === "csv" ? "public.comma-separated-values-text" : "com.adobe.pdf",
      dialogTitle: title,
    });
  } catch (error) {
    logger.warn("money-export", "share failed", error, { format });
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  return true;
}
