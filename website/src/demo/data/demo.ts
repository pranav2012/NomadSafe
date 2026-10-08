export type TabId = "trip" | "safety" | "money" | "ai";

export const PEOPLE = ["Maya", "Leo", "Sofia"] as const;
export type Person = "You" | (typeof PEOPLE)[number];

/** Flatmates group: everyone's net balance in cents (positive = owed money). */
export const FLATMATES_NET: Record<Person, number> = {
  You: 17841,
  Maya: 10835,
  Leo: -17359,
  Sofia: -11317,
};
export const FLATMATES_YOUR_SPEND = 33374;


export interface ItineraryItem {
  id: string;
  time: string;
  title: string;
  sub: string;
  kind: "food" | "activity" | "transit" | "stay";
  done?: boolean;
}

export const TODAY: ItineraryItem[] = [
  { id: "pasteis", time: "09:30", title: "Pastéis de Belém", sub: "Rua de Belém 84", kind: "food", done: true },
  { id: "jeronimos", time: "10:30", title: "Jerónimos", sub: "Monastery · tickets saved", kind: "activity" },
  { id: "tram", time: "14:00", title: "Tram 28", sub: "Through Alfama", kind: "transit" },
  { id: "miradouro", time: "18:40", title: "Miradouro da Graça", sub: "Sunset", kind: "activity" },
  { id: "dinner", time: "20:30", title: "Dinner", sub: "Taberna da Rua das Flores", kind: "food" },
];
