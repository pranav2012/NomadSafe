const DEG = Math.PI / 180;

/** Approximate subsolar point (within ~1° and ~15 min), enough for a day/night line and sunrise countdowns. */
export function subsolarPoint(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86_400_000;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const longitude = -15 * (utcHours - 12);
  return { latitude: declination, longitude: ((longitude + 540) % 360) - 180 };
}

/** Unit vector toward the sun in the globe's world space (x east at lng 90°, y north, z at lng 0°). */
export function sunVector(date: Date): [number, number, number] {
  const { latitude, longitude } = subsolarPoint(date);
  const la = latitude * DEG;
  const lo = longitude * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/**
 * Whether it is currently night at a place and how many hours until the next sunrise or sunset,
 * from the sunrise hour angle in local solar time. Polar day/night return `hoursUntil: null`.
 */
export function daylightAt(latitude: number, longitude: number, date: Date) {
  const { latitude: declination } = subsolarPoint(date);
  const cosH = -Math.tan(latitude * DEG) * Math.tan(declination * DEG);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solar = (((utcHours + longitude / 15) % 24) + 24) % 24;

  if (cosH <= -1) return { isNight: false, hoursUntil: null };
  if (cosH >= 1) return { isNight: true, hoursUntil: null };

  const halfDay = Math.acos(cosH) / DEG / 15;
  const sunrise = 12 - halfDay;
  const sunset = 12 + halfDay;
  const isNight = solar < sunrise || solar >= sunset;
  const target = isNight ? sunrise : sunset;
  const hoursUntil = (((target - solar) % 24) + 24) % 24;
  return { isNight, hoursUntil };
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLng = (b.longitude - a.longitude) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * DEG) * Math.cos(b.latitude * DEG) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const SYNODIC_MONTH_DAYS = 29.530589;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

/** Fraction of the moon's disc that is lit (0 new .. 1 full), from the mean synodic month. */
export function moonIllumination(date: Date) {
  const age = (((date.getTime() - KNOWN_NEW_MOON_MS) / 86_400_000) % SYNODIC_MONTH_DAYS + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  return (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH_DAYS)) / 2;
}
