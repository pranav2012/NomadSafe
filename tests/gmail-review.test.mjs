import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({ entryPoints: [entryPoint], bundle: true, format: "cjs", platform: "node", target: "node20", write: false })
    .outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const filter = loadModule("src/features/expenses/services/tripEmailFilter.ts");
const parsing = loadModule("src/features/expenses/services/gmailParsing.ts");
const review = loadModule("src/features/expenses/utils/gmailReview.ts");
const SELF = "__self__";

const trip = { id: "t1", destinations: ["Phuket, Thailand"], startDate: "2026-06-10", endDate: "2026-06-20" };
const abroad = { localCurrencies: ["THB"], domestic: false };
const atHome = { localCurrencies: [], domestic: true };
const mail = (body, sender = "alerts@hdfcbank.net", date = "2026-06-12T12:00:00.000Z") => ({ body, sender, date });

test("abroad, a spend in the destination's currency is kept; a food order or bill at home is not", () => {
  assert.equal(filter.tripSpendReason(mail("Transaction alert. THB 450.00 spent at 7-ELEVEN"), trip, { currency: "THB" }, abroad), null);
  assert.equal(
    filter.tripSpendReason(mail("Your Swiggy order is on its way. Paid ₹540", "Swiggy <noreply@swiggy.in>"), trip, { currency: "INR" }, abroad),
    "spend-not-trip",
  );
  assert.equal(filter.tripSpendReason(mail("Electricity bill paid Rs 2,300"), trip, { currency: "INR" }, abroad), "spend-not-trip");
});

test("a spend naming a destination or from a travel company is kept in any currency", () => {
  assert.equal(filter.tripSpendReason(mail("INR 3,200 spent at CAFE PHUKET OLD TOWN"), trip, { currency: "INR" }, abroad), null);
  assert.equal(
    filter.tripSpendReason(mail("Booking confirmed. Total INR 12,400", "Agoda <no-reply@agoda.com>"), trip, { currency: "INR" }, abroad),
    null,
  );
  assert.equal(filter.tripSpendReason(mail("Your trip with Uber. ₹320", "Uber Receipts <noreply@uber.com>"), trip, { currency: "INR" }, abroad), null);
  assert.equal(
    filter.tripSpendReason(mail("Your Uber Eats order. ₹420", "Uber Eats <noreply@uber.com>"), trip, { currency: "INR" }, abroad),
    "spend-not-trip",
  );
});

test("at home the currency says nothing: only destination mentions and travel companies count", () => {
  const goa = { ...trip, destinations: ["Goa, India"] };
  assert.equal(filter.tripSpendReason(mail("INR 900 spent at ZOMATO"), goa, { currency: "INR" }, atHome), "spend-not-trip");
  assert.equal(filter.tripSpendReason(mail("INR 900 spent at BEACH SHACK GOA"), goa, { currency: "INR" }, atHome), null);
  assert.equal(filter.tripSpendReason(mail("Your IRCTC e-ticket. Fare ₹1,450", "IRCTC <ticketadmin@irctc.co.in>"), goa, { currency: "INR" }, atHome), null);
});

test("mail before the trip is left to the pre-trip booking rule", () => {
  assert.equal(filter.tripSpendReason(mail("Paid ₹540", "x@y.com", "2026-05-01T12:00:00.000Z"), trip, { currency: "INR" }, abroad), null);
});

test("destination currencies come from the countries; a trip at home has none", () => {
  const currencyOf = (country) => ({ TH: "THB", VN: "VND", IN: "INR" })[country];
  assert.deepEqual(filter.tripSpendContext(["TH", "VN", "TH"], "IN", currencyOf), { localCurrencies: ["THB", "VND"], domestic: false });
  assert.deepEqual(filter.tripSpendContext(["IN"], "IN", currencyOf), { localCurrencies: [], domestic: true });
  assert.deepEqual(filter.tripSpendContext([], "IN", currencyOf), { localCurrencies: [], domestic: false });
});

test("at home, the Gmail query asks spends to name a destination or travel company", () => {
  const start = new Date(2026, 5, 10).getTime();
  const end = new Date(2026, 5, 21).getTime();
  const domestic = parsing.buildTripGmailQuery({ ...trip, destinations: ["Goa"] }, start, end, { domestic: true });
  assert.match(domestic, /\(receipt OR .*\) \(.*"goa".*agoda.*"booking\.com"/);
  const abroadQuery = parsing.buildTripGmailQuery(trip, start, end);
  assert.doesNotMatch(abroadQuery, /agoda/);
});

const companions = ["Sam", "Riya"];
const split = (input) => review.defaultSpendSplit({ text: "", amount: 100, currency: "USD", booking: true, companions, ...input });

test("bookings default to paid by you, split equally with everyone in minor units", () => {
  assert.deepEqual(split({}), {
    paidBy: SELF,
    shares: [
      { person: SELF, amount: 33.34 },
      { person: "Sam", amount: 33.33 },
      { person: "Riya", amount: 33.33 },
    ],
  });
  assert.deepEqual(split({ booking: false }), {});
  assert.deepEqual(split({ companions: [] }), {});
});

test("a head-count in the email narrows the default split", () => {
  assert.deepEqual(split({ text: "Booking for 1 adult" }), {});
  const named = split({ text: "Double room for guest Sam Rivera. You booked for 2 adults" });
  assert.deepEqual(named.shares?.map((share) => share.person), [SELF, "Sam"]);
  const unclear = split({ text: "You booked for 2 adults" });
  assert.equal(unclear.splitHint?.pax, 2);
  assert.equal(unclear.shares, undefined);
});

test("a booking spend is told by its category, the provider or a booking in the same email", () => {
  assert.equal(review.isBookingSpend("stays", { committedBooking: false, hasBooking: false }), true);
  assert.equal(review.isBookingSpend("travel", { committedBooking: false, hasBooking: false }), true);
  assert.equal(review.isBookingSpend("other", { committedBooking: false, hasBooking: true }), true);
  assert.equal(review.isBookingSpend("food", { committedBooking: false, hasBooking: false }), false);
  assert.equal(review.isBookingSpend("shopping", { committedBooking: false, hasBooking: false }), false);
});

test("the note's source is the sender's name, else its domain", () => {
  assert.equal(review.emailSenderName("Agoda <no-reply@agoda.com>"), "Agoda");
  assert.equal(review.emailSenderName('"Booking.com" <noreply@booking.com>'), "Booking.com");
  assert.equal(review.emailSenderName("ticketadmin@irctc.co.in"), "Irctc");
  assert.equal(review.emailSenderName("noreply@mail.airbnb.com"), "Airbnb");
  assert.equal(review.emailSenderName(undefined), "");
});

const emailText = "From: Agoda <no-reply@agoda.com>\nSubject: Booking confirmed\nReceived: 2026-05-01\n\nYour stay at Maple Leaf Hostel is confirmed. Total THB 3,400.";
const legacy = {
  source: "email",
  externalId: "gmail:m1",
  merchant: "Maple Leaf Hostel",
  amount: 3400,
  currency: "THB",
  category: "stays",
  date: "2026-05-01T10:00:00.000Z",
  note: emailText,
  location: null,
};
const fresh = { merchant: "Maple Leaf Hostel", amount: 3400, currency: "THB", category: "stays", date: "2026-05-01T10:00:00.000Z" };

test("an older auto-import the user never changed goes back to review", () => {
  assert.equal(review.isUntouchedImportedExpense(legacy, fresh, emailText), true);
  const autoSplit = { ...legacy, paidBy: SELF, shares: [{ person: SELF, amount: 1700 }, { person: "Sam", amount: 1700 }] };
  assert.equal(review.isUntouchedImportedExpense(autoSplit, fresh, emailText), true);
});

test("any change keeps an older import where it is", () => {
  assert.equal(review.isUntouchedImportedExpense({ ...legacy, amount: 3000 }, fresh, emailText), false);
  assert.equal(review.isUntouchedImportedExpense({ ...legacy, category: "other" }, fresh, emailText), false);
  assert.equal(review.isUntouchedImportedExpense({ ...legacy, note: "Paid by Sam's card" }, fresh, emailText), false);
  assert.equal(review.isUntouchedImportedExpense({ ...legacy, location: { latitude: 1, longitude: 2 } }, fresh, emailText), false);
  const uneven = { ...legacy, paidBy: SELF, shares: [{ person: SELF, amount: 3000 }, { person: "Sam", amount: 400 }] };
  assert.equal(review.isUntouchedImportedExpense(uneven, fresh, emailText), false);
  assert.equal(review.isUntouchedImportedExpense({ ...legacy, paidBy: "Sam", shares: [{ person: SELF, amount: 1700 }, { person: "Sam", amount: 1700 }] }, fresh, emailText), false);
  // Spends confirmed in review carry a short source line, never the email.
  assert.equal(review.isUntouchedImportedExpense({ ...legacy, note: "From Agoda · 1 May" }, fresh, emailText), false);
});

test("older auto-imported bookings return to review only when untouched, re-read and not shared", () => {
  const base = { tripId: "t1", source: "email", note: emailText, externalId: "gmail:m1#0", sourceIds: ["gmail:m2#0"] };
  const events = [
    { ...base, id: "a" },
    { ...base, id: "edited", editedAt: "2026-05-02" },
    { ...base, id: "done", doneAt: "2026-06-11" },
    { ...base, id: "ticket" },
    { ...base, id: "held", ticketHolders: [SELF] },
    { ...base, id: "confirmed", note: undefined },
    { ...base, id: "manual", source: "manual" },
    { ...base, id: "other-trip", tripId: "t2" },
    { ...base, id: "unread", sourceIds: ["gmail:m9#1"] },
  ];
  const options = { tripId: "t1", shared: false, messageIds: new Set(["gmail:m1", "gmail:m2"]), ticketEventIds: new Set(["ticket"]) };
  assert.deepEqual(review.selectReturnableEvents(events, options).map((event) => event.id), ["a"]);
  assert.deepEqual(review.selectReturnableEvents(events, { ...options, shared: true }), []);
});

test("a generic booking-site spend repeating a named one isn't proposed again", () => {
  const named = { merchant: "Maple Leaf Hostel", amount: 3400, currency: "THB", date: "2026-05-01T10:00:00.000Z" };
  assert.equal(review.isRepeatSpend({ ...named, merchant: "Booking" }, [named]), true);
  assert.equal(review.isRepeatSpend({ ...named, merchant: "Booking", amount: 3500 }, [named]), false);
  assert.equal(review.isRepeatSpend(named, [{ ...named, merchant: "Booking" }]), false);
  assert.equal(review.isRepeatSpend({ ...named, externalId: "gmail:m1" }, [{ ...named, merchant: "x", externalId: "gmail:m1" }]), true);
});

const stay = { type: "stay", title: "Maple Leaf Hostel", startAt: "2026-06-10T14:00:00", endAt: "2026-06-13T11:00:00", externalId: "gmail:m1#0" };

test("a reminder for a proposed booking merges into it instead of a second proposal", () => {
  const reminder = { ...stay, title: "Booking", externalId: "gmail:m5#0" };
  assert.equal(review.findSameBooking([{ ...stay, type: "transit" }, stay], reminder), 1);
  assert.equal(review.findSameBooking([stay], { ...stay, startAt: "2026-06-15T14:00:00", endAt: "2026-06-16T11:00:00" }), -1);
});

test("a dismissed booking stays dismissed, from the same email or a new one", () => {
  const dismissed = { ids: ["gmail:m1#0"], bookings: [stay] };
  assert.equal(review.isDismissedBooking(dismissed, { ...stay, externalId: "gmail:m1#0" }), true);
  assert.equal(review.isDismissedBooking(dismissed, { ...stay, externalId: "gmail:m7#0", bookingRef: undefined }), true);
  assert.equal(review.isDismissedBooking({ ids: [], bookings: [] }, stay), false);
  assert.equal(
    review.isDismissedBooking(dismissed, { type: "transit", title: "IndiGo", startAt: "2026-06-10T09:00:00", externalId: "gmail:m8#0" }),
    false,
  );
});
