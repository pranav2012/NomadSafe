/** Minutes after midnight, local time. */
export type MealWindow = [from: number, to: number];

export interface MealWindows {
  lunch: MealWindow;
  dinner: MealWindow;
}

const h = (hours: number) => Math.round(hours * 60);
const windows = (lunch: [number, number], dinner: [number, number]): MealWindows => ({
  lunch: [h(lunch[0]), h(lunch[1])],
  dinner: [h(dinner[0]), h(dinner[1])],
});

// Rough local averages (Eurobarometer food-to-go survey, ISPOR 2017 meal-time study); a trip's own meal times override them.
const EARLY = windows([12, 14], [18, 20]);
const EAST_ASIA = windows([11.5, 13.5], [18, 20]);
const MEDITERRANEAN = windows([13, 15], [20, 22]);
const LATE = windows([13.5, 15.5], [21, 23]);

export const DEFAULT_MEAL_WINDOWS = windows([12, 14], [19, 21]);

const BY_COUNTRY: Record<string, MealWindows> = {
  ...Object.fromEntries(["GB", "IE", "NL", "DE", "AT", "CH", "BE", "DK", "SE", "NO", "FI", "IS", "PL", "CZ", "US", "CA", "AU", "NZ"].map((code) => [code, EARLY])),
  ...Object.fromEntries(["JP", "CN", "KR", "TW", "HK", "MO", "TH", "VN", "SG", "MY", "ID", "PH"].map((code) => [code, EAST_ASIA])),
  ...Object.fromEntries(["IT", "GR", "PT", "TR", "HR", "IN", "LK", "NP", "MX", "BR"].map((code) => [code, MEDITERRANEAN])),
  ...Object.fromEntries(["ES", "AR", "UY", "CL", "SA", "AE", "KW", "QA", "BH", "OM", "JO", "EG"].map((code) => [code, LATE])),
  FR: windows([12, 14], [19.5, 21.5]),
};

export function countryMealWindows(country: string | null | undefined): MealWindows {
  return (country && BY_COUNTRY[country.toUpperCase()]) || DEFAULT_MEAL_WINDOWS;
}
