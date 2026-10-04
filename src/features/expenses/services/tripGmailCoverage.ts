import { tripMailWindow } from "@/features/expenses/services/gmailParsing";

/** Bump when email parsing changes so every trip re-reads its mail once with the new parser. */
export const GMAIL_PARSER_VERSION = 5;

export interface TripGmailCoverage {
  account: string;
  parserVersion?: number;
  startDate: string;
  destinations: string;
  /** Epoch ms range of received mail already scanned. */
  from: number;
  to: number;
}

export interface GmailScanWindow {
  after: number;
  before: number;
}

interface CoverageTrip {
  startDate: string;
  endDate: string;
  destinations: string[];
}

// Re-reads a little before the last check so mail indexed late isn't skipped; dedupe drops repeats.
const OVERLAP_MS = 10 * 60_000;
const MIN_GAP_MS = 60_000;

const normalizeDestinations = (destinations: string[]) =>
  destinations.map((destination) => destination.trim().toLowerCase()).sort().join("|");

/** Start date, destinations and account decide what the earlier scans matched; any change voids them. */
function sameScope(coverage: TripGmailCoverage, trip: CoverageTrip, account: string): boolean {
  return (
    coverage.account === account &&
    coverage.parserVersion === GMAIL_PARSER_VERSION &&
    coverage.startDate === trip.startDate.slice(0, 10) &&
    coverage.destinations === normalizeDestinations(trip.destinations)
  );
}

/** Mail still to scan: the whole window on first scan or changed details, else only mail since the last check. */
export function nextGmailScanWindow(
  trip: CoverageTrip,
  coverage: TripGmailCoverage | null | undefined,
  account: string,
  now: number,
): GmailScanWindow | null {
  const window = tripMailWindow(trip);
  if (!window) return null;
  const end = Math.min(window.end, now);
  if (end <= window.from) return null;
  if (!coverage || !sameScope(coverage, trip, account)) return { after: window.from, before: end };
  if (end - coverage.to < MIN_GAP_MS) return null;
  return { after: Math.max(window.from, coverage.to - OVERLAP_MS), before: end };
}

export function coverageAfterScan(
  trip: CoverageTrip,
  account: string,
  scanned: GmailScanWindow,
  previous: TripGmailCoverage | null | undefined,
): TripGmailCoverage {
  const keep = previous && sameScope(previous, trip, account);
  return {
    account,
    parserVersion: GMAIL_PARSER_VERSION,
    startDate: trip.startDate.slice(0, 10),
    destinations: normalizeDestinations(trip.destinations),
    from: keep ? Math.min(previous.from, scanned.after) : scanned.after,
    to: scanned.before,
  };
}
