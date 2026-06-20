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
