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

const { parseBookingEmail } = loadModule("src/features/itinerary/services/bookingEmailParser.ts");
const email = (body, date = "2026-09-13T10:00:00.000Z") => ({ body, date, sender: "noreply@booking.com" });

// Formats copied from real confirmation emails; names, numbers and prices are made up.
const CONFIRMED =
  "🛄 Thanks! Your booking is confirmed at Maple Leaf Hostel Asakusa. Booking.com Confirmation: 1234567890 PIN: 1111 (Confidential) " +
  "Thanks Alex! Your booking in Tokyo is confirmed. [checkmark.png] Maple Leaf Hostel Asakusa is expecting you on Sun 18 Oct " +
  "Reservation details Check-in Sunday, 18 October 2026 (15:00 - 23:00) Check-out Wednesday, 21 October 2026 (until 10:00) " +
  "Your reservation 3 nights, 2 rooms Cancellation cost * from 2 October 2026 22:22: ¥9,000";

test("reads a Booking.com stay: name, wall-clock check-in/out and booking number", () => {
  const { handled, bookings } = parseBookingEmail(email(CONFIRMED));
  assert.ok(handled);
  assert.deepEqual(bookings, [
    {
      type: "stay",
      title: "Maple Leaf Hostel Asakusa",
      detail: "",
      startAt: "2026-10-18T15:00:00",
      endAt: "2026-10-21T10:00:00",
      bookingRef: "1234567890",
      cancelled: undefined,
    },
  ]);
});

test("takes the end of a check-out time range and keeps Latin names only", () => {
  const body =
    "🛄 Thanks! Your booking is confirmed at Pine Hostel Beppu パインホステル別府. Booking.com Confirmation number: 2233445566 PIN code: 2222 " +
    "Your reservation 2 nights, 1 room Change Check-in Monday 2 November 2026 (15:00 - 21:00) Check-out Wednesday 4 November 2026 (07:00 - 10:00) Booking number 2233445566";
  const [stay] = parseBookingEmail(email(body)).bookings;
  assert.equal(stay.title, "Pine Hostel Beppu");
  assert.equal(stay.startAt, "2026-11-02T15:00:00");
  assert.equal(stay.endAt, "2026-11-04T10:00:00");
});

test("flags cancellations with the booking number they cancel", () => {
  const body =
    "Booking cancelled for Maple Leaf Hostel Asakusa. Booking.com Confirmation number: 1234567890 PIN code: 1111 Your booking has been successfully cancelled for free " +
    "You booked for 2 adults Check-in Sunday 18 October 2026 Check-out Tuesday 20 October 2026 Booking number 1234567890";
  const [stay] = parseBookingEmail(email(body)).bookings;
  assert.equal(stay.cancelled, true);
  assert.equal(stay.bookingRef, "1234567890");
  assert.equal(stay.title, "Maple Leaf Hostel Asakusa");
});

test("ignores host messages, special requests, receipts and insurance", () => {
  for (const head of [
    "You have a message from Maple Leaf Hostel Asakusa. You have a new message Check-in ：Sunday 18 October 2026",
    "Special Request for your Reservation 1234567890. Booking.com Check-in Sunday, 18 October 2026",
    "This is your receipt. Booking.com This is your receipt Check-out Wednesday, 21 October 2026 Amount paid ¥9,000",
    "Travel Insurance Policy Schedule for your trip. Departure 18 Oct 2026",
  ]) {
    assert.deepEqual(parseBookingEmail(email(head)), { handled: true, bookings: [] }, head.slice(0, 40));
  }
});

test("reads airline itinerary legs, including nested airport names and a missing year", () => {
  const body =
    "Sample Airways Tickets Confirmation e-mail. Flight information Bengaluru Tokyo 18 Oct\">Sun 18 Oct Fare: Economy " +
    "XA754 SKY SUITE 02:55 Bengaluru ( Kempegowda Intl ) 14:35 Tokyo ( Narita ) Osaka Delhi 7 Nov\">Sat 7 Nov Fare: Economy " +
    "XA106 08:30 Osaka ( Osaka Intl (Itami) ) 09:35 Tokyo ( Tokyo Intl Haneda ) Seat 28E XA39 SKY SUITE 23:45 Tokyo ( Tokyo Intl Haneda ) 05:05 Delhi ( Indira Gandhi Intl )";
  const legs = parseBookingEmail(email(body, "2026-09-10T08:00:00.000Z")).bookings.map((b) => [b.title, b.detail, b.startAt, b.endAt]);
  assert.deepEqual(legs, [
    ["XA754", "Bengaluru → Tokyo", "2026-10-18T02:55:00", "2026-10-18T14:35:00"],
    ["XA106", "Osaka → Tokyo", "2026-11-07T08:30:00", "2026-11-07T09:35:00"],
    ["XA39", "Tokyo → Delhi", "2026-11-07T23:45:00", "2026-11-08T05:05:00"],
  ]);
});

test("reads ticket bookings as activities on their participation date", () => {
  const body =
    "You're on your way! Booking BKQ123456 confirmed.. Hey Alex, your booking has been confirmed! Your booking for Sample Theme Park 1-Day Passport has been confirmed. " +
    "Participation Date: 2026-10-23 Units: 2 x Adult";
  const [activity] = parseBookingEmail(email(body, "2026-10-02T08:00:00.000Z")).bookings;
  assert.equal(activity.type, "activity");
  assert.equal(activity.title, "Sample Theme Park 1-Day Passport");
  assert.equal(activity.startAt, "2026-10-23T09:00:00");
  assert.equal(activity.bookingRef, "BKQ123456");
});

test("leaves unrecognised emails to the fallback", () => {
  assert.equal(parseBookingEmail(email("Weekly digest. Markets rose 2% this week.")).handled, false);
});
