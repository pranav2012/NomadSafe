import { v } from "convex/values";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { authComponent } from "./auth";

// Every action here is one or more billed Google calls; the app caches results, so this only bites abuse.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  places: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  // Destination search sends a few suggestion requests per search while typing.
  destinations: { kind: "token bucket", rate: 300, period: HOUR, capacity: 60 },
});

/** Signed-in, rate-limited caller; throws otherwise. */
async function authorize(ctx: ActionCtx, bucket: "places" | "destinations" = "places") {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");
  await rateLimiter.limit(ctx, bucket, { key: user._id, throws: true });
}

interface GooglePlace {
  displayName?: { text?: string };
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  shortFormattedAddress?: string;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { periods?: OpeningPeriod[] };
  utcOffsetMinutes?: number;
  photos?: { name?: string; authorAttributions?: { displayName?: string }[] }[];
}

interface OpeningPeriod {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
}

const NEARBY_CATEGORIES = {
  food: { types: ["restaurant"], radius: 1_500, minRating: 4.2, rank: "POPULARITY" },
  coffee: { types: ["cafe", "coffee_shop", "bakery"], radius: 1_500, minRating: 4.2, rank: "POPULARITY" },
  sights: { types: ["tourist_attraction", "museum", "park", "historical_landmark"], radius: 3_000, minRating: 4.2, rank: "POPULARITY" },
  essentials: { types: ["atm", "pharmacy", "supermarket", "convenience_store"], radius: 1_500, minRating: null, rank: "DISTANCE" },
} as const;

// Older app builds call without a category and get the original food + coffee mix.
const LEGACY_CATEGORY = { types: ["restaurant", "cafe"], radius: 1_500, minRating: 4.2, rank: "POPULARITY" } as const;

const NEARBY_LIMIT = 6;

const minuteOfWeek = (point: OpeningPeriod["open"]) => ((point?.day ?? 0) * 24 + (point?.hour ?? 0)) * 60 + (point?.minute ?? 0);

/** Weekly opening windows as [open, close] minutes from Sunday 00:00 local, so the app can tell "open now" from a cached result. */
function hoursOf(place: GooglePlace) {
  const periods = place.regularOpeningHours?.periods;
  if (!periods?.length || typeof place.utcOffsetMinutes !== "number") return null;
  return {
    utcOffsetMinutes: place.utcOffsetMinutes,
    windows: periods.map((period) => [minuteOfWeek(period.open), period.close ? minuteOfWeek(period.close) : null] as [number, number | null]),
  };
}

/** Resolves a Places photo resource to a short-lived image URL (no API key in it), or null. */
async function photoUrl(name: string, apiKey: string) {
  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=600&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { photoUri?: string };
    return body.photoUri ?? null;
  } catch {
    return null;
  }
}

export const searchNearby = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    category: v.optional(v.union(v.literal("food"), v.literal("coffee"), v.literal("sights"), v.literal("essentials"))),
  },
  handler: async (ctx, { latitude, longitude, category }) => {
    await authorize(ctx);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("Places search is unavailable");

    const config = category ? NEARBY_CATEGORIES[category] : LEGACY_CATEGORY;
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.displayName",
          "places.googleMapsUri",
          "places.location",
          "places.primaryTypeDisplayName",
          "places.rating",
          "places.shortFormattedAddress",
          "places.userRatingCount",
          "places.currentOpeningHours.openNow",
          "places.regularOpeningHours.periods",
          "places.utcOffsetMinutes",
          "places.photos",
        ].join(","),
      },
      body: JSON.stringify({
        includedTypes: config.types,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: config.radius,
          },
        },
        maxResultCount: 20,
        rankPreference: config.rank,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[places] Nearby Search failed", response.status, detail);
      throw new Error(`Places API request failed (${response.status})`);
    }

    const body = (await response.json()) as { places?: GooglePlace[] };
    const minRating = config.minRating;
    const matches = (body.places ?? []).filter(
      (place) =>
        typeof place.displayName?.text === "string" &&
        typeof place.location?.latitude === "number" &&
        typeof place.location?.longitude === "number" &&
        (minRating === null || (typeof place.rating === "number" && place.rating >= minRating)),
    );
    // Distance-ranked categories keep Google's order; the rest go best-rated first.
    const ranked =
      minRating === null
        ? matches
        : matches.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0));

    return Promise.all(
      ranked.slice(0, NEARBY_LIMIT).map(async (place) => {
        const photo = category ? place.photos?.[0] : undefined;
        return {
          name: place.displayName!.text!,
          category: place.primaryTypeDisplayName?.text ?? "Restaurant",
          rating: place.rating ?? null,
          ratingCount: place.userRatingCount ?? 0,
          address: place.shortFormattedAddress ?? "",
          latitude: place.location!.latitude!,
          longitude: place.location!.longitude!,
          mapsUrl: place.googleMapsUri ?? null,
          openNow: place.currentOpeningHours?.openNow ?? null,
          hours: hoursOf(place),
          photoUrl: photo?.name ? await photoUrl(photo.name, apiKey) : null,
          photoAuthor: photo?.authorAttributions?.[0]?.displayName ?? null,
        };
      }),
    );
  },
});

type SafetyKind = "hospital" | "police" | "pharmacy";

interface GoogleSafetyPlace {
  displayName?: { text?: string };
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  shortFormattedAddress?: string;
  nationalPhoneNumber?: string;
}

const SAFETY_KINDS: SafetyKind[] = ["hospital", "police", "pharmacy"];

/** Hospitals, police and pharmacies within 2 km, nearest first, for the trip safety map. */
export const searchSafetyPlaces = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, { latitude, longitude }) => {
    await authorize(ctx);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("Places search is unavailable");

    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.displayName",
          "places.googleMapsUri",
          "places.location",
          "places.types",
          "places.shortFormattedAddress",
          "places.nationalPhoneNumber",
        ].join(","),
      },
      body: JSON.stringify({
        includedTypes: SAFETY_KINDS,
        locationRestriction: { circle: { center: { latitude, longitude }, radius: 2_000 } },
        maxResultCount: 20,
        rankPreference: "DISTANCE",
      }),
    });

    if (!response.ok) {
      console.warn("[places] Safety search failed", response.status, await response.text());
      throw new Error(`Places API request failed (${response.status})`);
    }

    const body = (await response.json()) as { places?: GoogleSafetyPlace[] };
    return (body.places ?? []).flatMap((place) => {
      const kind = SAFETY_KINDS.find((k) => place.types?.includes(k));
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (!kind || !place.displayName?.text || typeof lat !== "number" || typeof lng !== "number") return [];
      return [
        {
          kind,
          name: place.displayName.text,
          address: place.shortFormattedAddress ?? "",
          phone: place.nationalPhoneNumber ?? null,
          latitude: lat,
          longitude: lng,
          mapsUrl: place.googleMapsUri ?? null,
        },
      ];
    });
  },
});

/** Resolves a named place (e.g. a hotel from the itinerary) near a point to coordinates, or null. */
export const findPlaceByName = action({
  args: {
    query: v.string(),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, { query, latitude, longitude }) => {
    await authorize(ctx);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("Places search is unavailable");

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({
        textQuery: query.slice(0, 120),
        pageSize: 1,
        locationBias: { circle: { center: { latitude, longitude }, radius: 50_000 } },
      }),
    });

    if (!response.ok) {
      console.warn("[places] Text search failed", response.status, await response.text());
      return null;
    }

    const body = (await response.json()) as { places?: GooglePlace[] };
    const place = body.places?.[0];
    const lat = place?.location?.latitude;
    const lng = place?.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { name: place?.displayName?.text ?? query, latitude: lat, longitude: lng };
  },
});

const PLACE_ID = /^[A-Za-z0-9_-]{1,512}$/;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{1,36}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const DESTINATION_SUGGESTIONS = 5;

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
}

function placesApiKey() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Places search is unavailable");
  return apiKey;
}

/**
 * City, region and country suggestions from Places Autocomplete (New). Requests that share a
 * session token and end in a Place Details call are billed as that one call.
 */
async function autocompleteRegions(apiKey: string, input: string, language: string | undefined, sessionToken: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: input.trim().slice(0, 100),
      includedPrimaryTypes: ["(regions)"],
      sessionToken,
      ...(language && LANGUAGE.test(language) ? { languageCode: language } : {}),
    }),
  });
  if (!response.ok) {
    console.warn("[places] Autocomplete failed", response.status, await response.text());
    throw new Error(`Places API request failed (${response.status})`);
  }

  const body = (await response.json()) as AutocompleteResponse;
  return (body.suggestions ?? []).flatMap(({ placePrediction: prediction }) => {
    const main = prediction?.structuredFormat?.mainText?.text ?? prediction?.text?.text;
    if (!prediction?.placeId || !main) return [];
    const secondary = prediction.structuredFormat?.secondaryText?.text;
    return [{ placeId: prediction.placeId, label: secondary ? `${main}, ${secondary}` : main }];
  });
}

/** Coordinates for a place id (Place Details Essentials: location only), or null. */
async function placeLocation(apiKey: string, placeId: string, sessionToken: string) {
  if (!PLACE_ID.test(placeId)) return null;
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}?sessionToken=${encodeURIComponent(sessionToken)}`,
    { headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "location" } },
  );
  if (!response.ok) {
    console.warn("[places] Place Details failed", response.status, await response.text());
    return null;
  }
  const body = (await response.json()) as GooglePlace;
  const latitude = body.location?.latitude;
  const longitude = body.location?.longitude;
  return typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null;
}

/** Destination suggestions while typing; the app only asks when its offline cities run short. */
export const autocompleteDestinations = action({
  args: {
    input: v.string(),
    sessionToken: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, { input, sessionToken, language }) => {
    if (input.trim().length < 2 || !SESSION_TOKEN.test(sessionToken)) return [];
    await authorize(ctx, "destinations");
    const suggestions = await autocompleteRegions(placesApiKey(), input, language, sessionToken);
    return suggestions.slice(0, DESTINATION_SUGGESTIONS);
  },
});

/** Coordinates for a picked suggestion; closes its autocomplete session. */
export const resolveDestination = action({
  args: {
    placeId: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { placeId, sessionToken }) => {
    if (!SESSION_TOKEN.test(sessionToken)) return null;
    await authorize(ctx, "destinations");
    return placeLocation(placesApiKey(), placeId, sessionToken);
  },
});

/** Coordinates for a destination label with no known coordinates (top suggestion + details), or null. */
export const geocodeDestination = action({
  args: {
    query: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, { query, language }) => {
    if (query.trim().length < 2) return null;
    await authorize(ctx, "destinations");
    const apiKey = placesApiKey();
    const sessionToken = crypto.randomUUID();
    const [top] = await autocompleteRegions(apiKey, query, language, sessionToken);
    return top ? placeLocation(apiKey, top.placeId, sessionToken) : null;
  },
});
