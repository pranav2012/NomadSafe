import { useEffect, useState } from "react";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  buildImportCandidates,
  candidateToInput,
} from "@/features/expenses/services/importPipeline";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import type { Trip } from "@/features/trips/store/tripsStore";

// Runs once per app session for the trip that is active when Gmail becomes available.
let sessionSynced = false;

export interface GmailAutoSync {
  importedCount: number | null;
  dismiss: () => void;
}

/**
 * On launch, if Gmail is connected, silently fetches recent transaction emails
 * and adds any new (non-duplicate) spends to the ledger. Categorization uses the
 * keyword heuristic only, so it never loads the local model at startup. Returns
 * the count of newly added spends so the screen can show a banner.
 */
export function useGmailAutoSync(trip: Trip | null): GmailAutoSync {
  const gmail = useGmailImport();
  const addExpenses = useExpensesStore((state) => state.addExpenses);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!trip || sessionSynced || !gmail.connected) return;
    sessionSynced = true;

    let mounted = true;
    (async () => {
      try {
        const messages = await gmail.fetchEmails();
        const candidates = await buildImportCandidates(messages, "email", {
          allowModel: false,
          trip,
        });
        await gmail.completeSync();
        const fresh = candidates.filter((candidate) => !candidate.duplicate);
        if (mounted && fresh.length > 0) {
          const inputs = await Promise.all(
            fresh.map((candidate) => candidateToInput(candidate, trip.id, trip.currency)),
          );
          addExpenses(inputs);
          setImportedCount(fresh.length);
        }
      } catch {
        // Background sync is best-effort; failures stay silent.
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail.connected, trip]);

  return { importedCount, dismiss: () => setImportedCount(null) };
}
