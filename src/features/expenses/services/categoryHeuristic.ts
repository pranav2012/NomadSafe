import type { ExpenseCategory } from "@/features/expenses/constants/categories";

export interface CategorizerInput {
  merchant: string;
  note?: string;
  rawText?: string;
}

// Checked in this order; travel is last so generic transport words don't win ties.
const KEYWORDS: [ExpenseCategory, string[]][] = [
  [
    "food",
    [
      "restaurant", "restaurante", "ristorante", "trattoria", "osteria", "pizzeria",
      "cafe", "caffe", "coffee", "starbucks", "costa coffee", "tim hortons", "dunkin",
      "mcdonald", "burger king", "kfc", "domino",
      "pizza", "burger", "bar", "pub", "bistro", "brasserie", "diner", "eatery",
      "bakery", "boulangerie", "patisserie", "panaderia", "taqueria", "cerveceria",
      "swiggy", "zomato", "ubereats", "uber eats", "grabfood", "doordash", "deliveroo",
      "just eat", "foodpanda", "glovo", "wolt", "food", "kitchen", "noodle", "ramen",
      "sushi", "deli", "grill", "chai", "haldiram", "chaayos", "warung", "izakaya",
    ],
  ],
  [
    "stays",
    [
      "hotel", "hostel", "airbnb", "booking.com", "agoda", "oyo", "resort", "inn",
      "lodge", "guesthouse", "guest house", "marriott", "hyatt", "hilton", "ibis",
      "novotel", "accor", "radisson", "sheraton", "holiday inn", "hostelworld",
      "accommodation", "maison", "pension", "ryokan", "motel",
    ],
  ],
  [
    "shopping",
    [
      "el corte ingles", "galeries lafayette", "printemps", "harrods", "selfridges",
      "john lewis", "marks & spencer", "macy", "nordstrom", "kaufhof", "rinascente",
      "carrefour", "lidl", "aldi", "tesco", "sainsbury", "asda", "waitrose", "mercadona",
      "auchan", "leclerc", "intermarche", "monoprix", "franprix", "rewe", "edeka",
      "albert heijn", "spar", "coop", "conad", "esselunga", "woolworths", "coles",
      "countdown", "loblaws", "kroger", "safeway", "whole foods", "trader joe",
      "walmart", "target", "costco", "big bazaar", "dmart", "d-mart", "reliance",
      "more supermarket", "spencer", "nature's basket", "bigbasket", "blinkit", "zepto",
      "instamart", "lotus", "big c", "tops market", "familymart", "family mart", "lawson",
      "7-eleven", "7 eleven", "seven eleven", "boots", "superdrug", "walgreens", "cvs",
      "watsons", "guardian", "apollo pharmacy", "medplus", "dm drogerie", "rossmann",
      "sephora", "zara", "h&m", "uniqlo", "primark", "mango", "bershka", "pull&bear",
      "stradivarius", "massimo dutti", "decathlon", "ikea", "muji", "daiso", "don quijote",
      "fnac", "media markt", "mediamarkt", "croma", "best buy", "apple store",
      "amazon", "flipkart", "myntra", "ajio", "nykaa", "lulu", "mall", "store",
      "market", "supermarket", "supermercado", "supermarche", "hypermarket", "grocery",
      "groceries", "mart", "shop", "shopping", "boutique", "retail", "duty free",
      "pharmacy", "pharmacie", "farmacia", "apotheke", "chemist", "drugstore",
      "electronics", "apparel", "department store",
    ],
  ],
  [
    "travel",
    [
      "uber", "ola", "grab", "lyft", "bolt", "cabify", "gojek", "rapido", "taxi", "cab",
      "metro", "subway", "train", "railway", "rail", "irctc", "renfe", "sncf", "trenitalia",
      "deutsche bahn", "eurostar", "amtrak", "flixbus", "redbus", "flight", "airlines",
      "airways", "airport", "ryanair", "easyjet", "vueling", "indigo", "air india",
      "emirates", "lufthansa", "bus", "ferry", "fuel", "petrol", "diesel", "gas station",
      "shell", "bp", "esso", "chevron", "indian oil", "bharat petroleum", "hp petrol",
      "repsol", "toll", "fastag", "parking", "car rental", "rental car", "hertz", "avis",
      "sixt", "europcar", "transit", "transport", "scooter", "bike rental", "lime",
    ],
  ],
  [
    "other",
    [
      "vodafone", "airtel", "jio", "orange", "movistar", "t-mobile", "verizon",
      "at&t", "telekom", "airalo", "holafly", "esim", "sim card", "recharge",
      "atm", "cash withdrawal",
    ],
  ],
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keywords must match whole words ("car" never matches "card"); a trailing "s"/"'s" is allowed.
const MATCHERS: [ExpenseCategory, RegExp][] = KEYWORDS.map(([category, keywords]) => [
  category,
  new RegExp(
    `(?:^|[^a-z0-9])(?:${keywords.map((keyword) => escapeRegExp(normalize(keyword))).join("|")})(?:'?s)?(?=$|[^a-z0-9])`,
  ),
]);

function matchCategory(text: string): ExpenseCategory | null {
  if (!text) return null;
  const haystack = normalize(text);
  for (const [category, matcher] of MATCHERS) {
    if (matcher.test(haystack)) return category;
  }
  return null;
}

/** Keyword categorization; merchant first, then note/raw text. `matched: false` means ask the local model. */
export function categorizeHeuristic(input: CategorizerInput): {
  category: ExpenseCategory;
  matched: boolean;
} {
  const category =
    matchCategory(input.merchant) ??
    matchCategory([input.note, input.rawText].filter(Boolean).join(" "));
  return category ? { category, matched: true } : { category: "other", matched: false };
}
