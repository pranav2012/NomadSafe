export interface NearbyPlace {
  name: string;
  category: string;
  rating: number;
  ratingCount: number;
  address: string;
  latitude: number;
  longitude: number;
  mapsUrl: string | null;
}
