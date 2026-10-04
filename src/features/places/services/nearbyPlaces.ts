import type { OpeningHours } from "@/features/places/utils/openingHours";

export type NearbyCategory = "food" | "coffee" | "sights" | "essentials";

export interface NearbyPlace {
  name: string;
  category: string;
  rating: number | null;
  ratingCount: number;
  address: string;
  latitude: number;
  longitude: number;
  mapsUrl: string | null;
  openNow: boolean | null;
  hours: OpeningHours | null;
  photoUrl: string | null;
  photoAuthor: string | null;
}
