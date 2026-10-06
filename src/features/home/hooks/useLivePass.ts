import type { TripEvent } from "@/features/itinerary";
import { TRANSIT_MODES } from "@/features/itinerary/constants/eventTypes";
import { livePlan, tonightStay } from "@/features/itinerary/utils/dayPlan";
import { describeEntry, formatters, routeOf } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import type { TimelineEntry } from "@/features/itinerary/utils/timeline";
import { parseRouteEnds, transitModeOf } from "@/features/itinerary/utils/transit";
import type { LivePass } from "@/features/home/types";
import type { HomeStage } from "@/features/home/utils/stage";
import { addDays, startOfLocalDay } from "@/features/trips/utils/dates";
import { useLocalization } from "@/localization";

const AIRPORT = /^[A-Z]{3}$/;
const ROUTE_AHEAD_MS = 24 * 3_600_000;

const code = (place: string) => (AIRPORT.test(place) ? place : place.replace(/[\s.,'’()\-]/g, "").slice(0, 3).toLocaleUpperCase() || "—");

interface LivePassInput {
  events: TripEvent[];
  now: Date;
  stage: HomeStage;
  day: number;
  totalDays: number;
  city?: string;
}

/** The pass's live face for the day before and during the trip; null otherwise (the pass shows the countdown). */
export function useLivePass({ events, now, stage, day, totalDays, city }: LivePassInput): LivePass | null {
  const { t, locale, hour12, formatCountdown } = useLocalization();
  if (stage !== "active" && stage !== "eve") return null;

  const format = formatters(locale, hour12);
  const nowMs = now.getTime();
  const { current, next } = livePlan(events, nowMs);
  if (stage === "eve" && !next) return null;

  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  const titleOf = (entry: TimelineEntry<TripEvent>) => {
    const { title } = describeEntry(entry, t, format, nowMs);
    if (entry.role === "check-in") return `${t("itinerary.defaults.checkIn")} · ${title}`;
    if (entry.role === "check-out") return `${t("itinerary.defaults.checkOut")} · ${title}`;
    return title;
  };

  const heading = stage === "eve" ? t("home.live.startsTomorrow") : [t("trip.dayProgress", { day, total: totalDays }), city].filter(Boolean).join(" · ");

  const nextAt = next ? new Date(next.at) : null;
  const ends = next && next.event.type === "transit" ? parseRouteEnds(routeOf(next.event.detail)) : null;
  const tonight = tonightStay(events, today);
  const hasToday = events.some((event) => startOfLocalDay(new Date(event.startAt)).getTime() === today.getTime());

  let top: LivePass["top"];
  if (current) {
    const until = current.event.endAt ? t("home.live.until", { time: format.time.format(new Date(current.event.endAt)) }) : undefined;
    top = { kind: "text", label: t("home.live.now"), title: titleOf(current), sub: until };
  } else if (next && nextAt && ends && nextAt.getTime() - nowMs <= ROUTE_AHEAD_MS) {
    const mode = transitModeOf(next.event);
    top = {
      kind: "route",
      from: code(ends[0]),
      to: code(ends[1]),
      fromName: ends[0],
      toName: ends[1],
      icon: TRANSIT_MODES.find((entry) => entry.id === mode)?.icon ?? "send",
    };
  } else if (tonight) {
    top = {
      kind: "text",
      label: t("home.live.tonight"),
      title: localizeEventTitle(tonight.event.title, t),
      sub: t("home.live.nightOf", { night: tonight.night, total: tonight.nights }),
    };
  } else {
    top = { kind: "text", label: t("home.live.today"), title: hasToday ? t("home.live.doneForToday") : t("home.live.freeDay") };
  }

  let stub: LivePass["stub"] = null;
  if (next && nextAt) {
    const nextDay = startOfLocalDay(nextAt).getTime();
    const label =
      nextDay === today.getTime()
        ? t("home.live.inDuration", { duration: formatCountdown((nextAt.getTime() - nowMs) / 60_000) })
        : nextDay === tomorrow.getTime()
          ? t("home.live.tomorrow")
          : format.dayHeader.format(nextAt);
    stub = { time: format.time.format(nextAt), label, title: titleOf(next) };
  }

  return { heading, top, stub };
}
