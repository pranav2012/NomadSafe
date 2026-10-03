import { v } from "convex/values";
import { action } from "./_generated/server";
import { authComponent } from "./auth";

interface GooglePlace {
  displayName?: { text?: string };
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  shortFormattedAddress?: string;
  userRatingCount?: number;
}

export const searchNearby = action({
  args: {
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, { latitude, longitude }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

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
          "places.primaryTypeDisplayName",
          "places.rating",
          "places.shortFormattedAddress",
          "places.userRatingCount",
        ].join(","),
      },
      body: JSON.stringify({
        includedTypes: ["restaurant", "cafe"],
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: 1_500,
          },
        },
        maxResultCount: 20,
        rankPreference: "POPULARITY",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[places] Nearby Search failed", response.status, detail);
      throw new Error(`Places API request failed (${response.status})`);
    }

    const body = (await response.json()) as { places?: GooglePlace[] };
    const places = (body.places ?? [])
      .filter(
        (place) =>
          typeof place.displayName?.text === "string" &&
          typeof place.rating === "number" &&
          place.rating >= 4.2 &&
          typeof place.location?.latitude === "number" &&
          typeof place.location?.longitude === "number",
      )
      .sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0),
      )
      .slice(0, 6)
      .map((place): { name: string; category: string; rating: number; ratingCount: number; address: string; latitude: number; longitude: number; mapsUrl: string | null } => ({
        name: place.displayName!.text!,
        category: place.primaryTypeDisplayName?.text ?? "Restaurant",
        rating: place.rating!,
        ratingCount: place.userRatingCount ?? 0,
        address: place.shortFormattedAddress ?? "",
        latitude: place.location!.latitude!,
        longitude: place.location!.longitude!,
        mapsUrl: place.googleMapsUri ?? null,
      }));

    return places;
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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

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
