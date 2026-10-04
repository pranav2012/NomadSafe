import { useEffect } from "react";
import { isGmailConfigured } from "@/features/expenses/services/gmailImport";
import { useTripGmailSyncStatus } from "@/features/expenses/store/gmailSyncStatusStore";
import { useLocalization } from "@/localization";
import { hasGmailGrant, hydrateGmailConnection, useGmailConnectionStore } from "@/features/expenses/store/gmailConnectionStore";

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

/** "Searching your inbox…" / "Reading emails… 340 of 1,200" while a Gmail download runs, else null. */
export function useGmailProgressLabel(tripId: string | null | undefined): string | null {
  const { t, locale } = useLocalization();
  const { progress } = useTripGmailSyncStatus(tripId);
  if (!progress) return null;
  if (progress.phase === "listing") return t("expenses.gmailSearching");
  const format = new Intl.NumberFormat(locale);
  return t("expenses.gmailReading", { done: format.format(progress.done), total: format.format(progress.total) });
}

/** Gmail connection state for entry points; connecting itself happens in the import sheet. */
export function useGmailStatus(): GmailStatus {
  const tokens = useGmailConnectionStore((state) => state.tokens);

  useEffect(() => {
    void hydrateGmailConnection();
  }, []);

  return {
    configured: isGmailConfigured(),
    connected: hasGmailGrant(tokens),
    email: tokens?.email ?? null,
  };
}
