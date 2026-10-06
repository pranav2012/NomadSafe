import { useEffect, useState } from "react";
import { fetchExchangeRate } from "@/features/expenses/services/currencyConversion";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import type { TripEvent } from "@/features/itinerary";
import { tonightStay } from "@/features/itinerary/utils/dayPlan";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { useSharingStore } from "@/features/location-sharing";
import { useHomeCountry } from "@/features/passport/hooks/usePassport";
import { countryAt } from "@/features/recap/utils/countryShapes";
import { countryDisplayName, nearestCityCountry } from "@/features/trips/data/destinations";
import { useEmbassy } from "@/features/trips/hooks/useEmbassy";
import type { Trip } from "@/features/trips/store/tripsStore";
import { countryFacts, emergencyTiles, needsAdapter, quoteUnits } from "@/features/trips/utils/countryFacts";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";
import type { PassBackContent, PassBackRow } from "@/features/home/components/aura/PassBack";
import { SAFETY_KIND_META } from "@/features/home/components/aura/safety/kinds";
import type { SafetyPlace } from "@/features/home/hooks/useTripSafety";
import type { HomeData, HomeStop } from "@/features/home/types";
import type { HomeStage } from "@/features/home/utils/stage";
import { distanceKm } from "@/features/home/components/aura/globe/sun";

// Beyond this the user isn't at the stop yet, so distances are measured from the stop instead.
const NEAR_STOP_KM = 50;

const flagOf = (iso: string) => String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

interface PassBackInput {
  trip: Trip;
  data: HomeData;
  stage: HomeStage;
  stop: HomeStop | undefined;
  here: { latitude: number; longitude: number } | null;
  places: SafetyPlace[] | null;
  events: TripEvent[];
  now: Date;
  onShowDriver: (stay: TripEvent) => void;
  onReplay: () => void;
}

/**
 * The back of the trip pass for each stage: before the trip, the destination's time difference,
 * currency, plugs and emergency numbers; during it, tap-to-call numbers, the nearest hospital, the
 * home embassy and the stay's address for a driver; after it, the trip's numbers and its replay.
 */
export function usePassBack({ trip, data, stage, stop, here, places, events, now, onShowDriver, onReplay }: PassBackInput) {
  const { t, locale, currency, formatCurrency, formatCountdown, formatDistance } = useLocalization();
  const home = useHomeCountry().code;
  const destination = stop ? (countryAt(stop.latitude, stop.longitude) ?? nearestCityCountry(stop.latitude, stop.longitude)) : null;
  const international = Boolean(home && destination && home !== destination);
  const embassy = useEmbassy(international ? home : null, international ? destination : null);
  const sharingCount = useSharingStore((state) => (state.isBroadcasting ? state.recipients.filter((person) => person.sharing).length : 0));
  const [rate, setRate] = useState<{ pair: string; rate: number } | null>(null);
  const local = countryFacts(destination)?.currency ?? null;
  const pair = `${local}:${currency}`;

  useEffect(() => {
    if (stage !== "upcoming" && stage !== "eve") return;
    if (!local || local === currency) return;
    let cancelled = false;
    fetchExchangeRate(local, currency, toLocalDayKey(new Date()))
      .then((result) => {
        if (!cancelled) setRate({ pair, rate: result.rate });
      })
      .catch((error: unknown) => logger.warn("travel-info", "exchange rate unavailable", error));
    return () => {
      cancelled = true;
    };
  }, [currency, local, pair, stage]);

  const facts = countryFacts(destination);
  const tiles = facts ? emergencyTiles(facts) : [];
  const aside = sharingCount > 0 ? t("passBack.sharingWith", { count: sharingCount }) : undefined;

  if (stage === "ended") {
    return {
      title: t("passBack.afterTitle"),
      aside: undefined,
      content: {
        kind: "after",
        stats: [
          { value: String(data.totalDays), label: t("passBack.days", { count: data.totalDays }) },
          { value: String(trip.destinations.length), label: t("passBack.places", { count: trip.destinations.length }) },
          ...(data.hasSpends ? [{ value: data.moneyValue, label: t("passBack.spent") }] : []),
        ],
        onReplay,
      } satisfies PassBackContent,
    };
  }

  const placeName = stop?.name.split(",")[0] ?? (destination ? countryDisplayName(destination, locale) : "");

  if (stage === "upcoming" || stage === "eve") {
    const rows: PassBackRow[] = [];
    const destOffset = places?.find((place) => typeof place.utcOffsetMinutes === "number")?.utcOffsetMinutes;
    if (typeof destOffset === "number") {
      const diff = destOffset + now.getTimezoneOffset();
      rows.push({
        icon: "clock",
        text:
          diff === 0
            ? t("passBack.sameTime", { place: placeName })
            : t(diff > 0 ? "passBack.ahead" : "passBack.behind", { place: placeName, duration: formatCountdown(Math.abs(diff)) }),
      });
    }
    if (local && local !== currency && rate?.pair === pair) {
      const units = quoteUnits(rate.rate);
      rows.push({
        icon: "wallet",
        text: `${formatCurrency(units, local, { maximumFractionDigits: 0 })} ≈ ${formatCurrency(rate.rate * units, currency, { maximumFractionDigits: 0 })}`,
      });
    }
    if (facts?.plugs) {
      const adapter = needsAdapter(countryFacts(home), facts);
      rows.push({
        icon: "plug",
        text: [t("passBack.plugs", { types: [...facts.plugs].join("/") }), facts.volts ? `${facts.volts} V` : null].filter(Boolean).join(" · "),
        meta: adapter === null ? undefined : adapter ? t("passBack.bringAdapter") : t("passBack.plugsFit"),
      });
    }
    return { title: t("passBack.beforeTitle", { place: placeName }), aside, content: { kind: "before", rows, tiles } satisfies PassBackContent };
  }

  const from = here && stop && distanceKm(here, stop) <= NEAR_STOP_KM ? here : stop;
  const hospitals = (places ?? []).filter((place) => place.kind === "hospital");
  const preferred = hospitals.some((place) => place.primary) ? hospitals.filter((place) => place.primary) : hospitals;
  const hospital = from
    ? preferred.map((place) => ({ place, km: distanceKm(from, place) })).sort((a, b) => a.km - b.km)[0]
    : undefined;
  const stay = tonightStay(events, now)?.event ?? events.find((event) => event.type === "stay" && new Date(event.endAt ?? event.startAt) >= now);

  const rows: PassBackRow[] = [];
  if (hospital) {
    rows.push({
      icon: SAFETY_KIND_META.hospital.icon,
      tone: SAFETY_KIND_META.hospital.color,
      text: hospital.place.name,
      meta: formatDistance(hospital.km),
      phone: hospital.place.phone,
      url: hospital.place.mapsUrl,
    });
  }
  if (international && home && embassy) {
    rows.push({ icon: "flag", text: `${flagOf(home)} ${embassy.name}`, phone: embassy.phone, url: embassy.mapsUrl });
  }
  if (stay) {
    rows.push({ icon: "building", text: localizeEventTitle(stay.title, t), meta: t("passBack.showDriver"), onPress: () => onShowDriver(stay) });
  }
  return { title: t("passBack.duringTitle"), aside, content: { kind: "during", tiles, rows: rows.slice(0, 3) } satisfies PassBackContent };
}
