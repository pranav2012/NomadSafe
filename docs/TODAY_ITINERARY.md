# Today on Home: day-wise itinerary

Status: discussion / design (2026-10-06). Nothing implemented yet.
Reference: japan.theclau.de/d/1 (a hand-written day plan: steps, transit legs, tips, "Tonight" stay, per-traveller view).

## Decisions so far

- Content is **Gmail bookings + the user's own stops**. No AI-generated plans, no "leave by" / directions API.
- Free for everyone.
- Solo trip: my items. Shared trip: everyone's items, in one view (no Mine/Everyone toggle).
- Gmail bookings on a shared trip: flights default to the importer, stays to everyone.
- Booking PDFs from the email (and files the user adds) are kept on the phone and work offline.
- Items can be ticked off. A few must-do suggestions are offered; only accepted ones appear. Users add and remove freely.
- New item types: `food` and `note`, next to `transit`, `stay`, `activity`.
- No-trip and past-trip Home keep the globe flow; finished trips hand off to the recap.
- Must-do suggestions come from a list bundled with the app (curated popular places per city), not Google Places or AI. Works offline.
- Tickets open in an in-app viewer (`react-native-pdf`, needs a dev-client rebuild) with max brightness for QR codes.
- Step 2 (built): `food` and `note` types; `timing` ("anytime" items sit at 00:00 of their day, "wishlist" items have no day); `doneAt` ticks shared with everyone; `people` (SELF_ID/names locally, member ids on the server, empty = everyone) on any trip with companions, Gmail flights default to the importer; other people's items fold into one row with "Together again" after; the pass shows today's to-dos and a "Meanwhile" line; Refine only tidies Gmail imports, on the phone.
- Baseline analytics shipped first (`home_viewed`, `itinerary_sheet_opened`, `itinerary_event_added/edited/deleted`).

## Home by trip stage

| Stage | When | Question it answers | Top of Home |
|---|---|---|---|
| None | No active trip | Where to next? | `EmptyHome` globe (unchanged) |
| Upcoming | 2+ days before start | Am I ready? | Globe + countdown + **Trip prep** card |
| Eve | The day before start / travel day | What happens tomorrow? | Globe + **Day 1 preview** |
| During | Trip running | What now, what next? | **Today** first; globe shrinks to a ~120 px strip (tap to expand) |
| Ended | Trip complete | How did it go? | Globe + recap card, then the next trip |

### Upcoming: Trip prep

```
┌ Trip prep ──────────────────────┐
│ ✈  Flight · Sat 18 Oct, 02:55   │  first booking
│ 🏨 3 of 4 stays booked          │
│ ⚠  No stay for nights 7–9       │  gaps from stay dates
│ Day 1 preview ›   All days ›    │
└─────────────────────────────────┘
```

### During: Today

```
 ▁▁▁ globe strip ▁▁▁                 [swap] [P]
 Day 4 of 21 · Kyoto · 22°
 ◀ ▪▪▪●▫▫▫▫▫▫▫▫ ▶                   DayRail picks the day shown
┌ NOW ────────────────────────────┐
│ Fushimi Inari · until 13:00     │
│ NEXT 14:30 Nishiki Market · 1h20│
│ Meanwhile: Suhas at teamLab     │  shared trips only
└─────────────────────────────────┘
 ✓ 09:00  Fushimi Inari     [Maps]
 ○ 14:30  Nishiki Market    [Maps]
 ┊ Suhas · teamLab · until 18:00  ›   someone else's plan, collapsed
 ○ 19:00  Dinner · Pontocho   🤝 together again
 Anytime: ○ Buy a Suica · ○ Ippodo tea
 + Add a stop
 🛏 Tonight: Hotel Gracery · night 2 of 3   [🎫 Voucher]
 [Add spend] [Check-in] [Share] [SOS]
 Money · Nearby
```

- Evening (after the last item or ~21:00): the Now card turns into "Tomorrow starts 08:10 · Check out".
- Free day: "Free day" + suggestions + Add a stop, not an empty timeline.
- Trip without any items: one card to import from Gmail or add the first stop.

### Shared trips: one timeline, your day in focus (no toggle)

- Items for everyone and items for me render normally (mine-only ones get a small "Just you" tag).
- Items only for others collapse into one muted line on the spine ("Suhas · teamLab · until 18:00"). Consecutive ones group: "Split up 13:00–18:00 · 2 plans for Suhas". Tap to expand.
- The first shared item after a split gets a "together again" marker.
- The Now card is always about me; on shared trips it adds one "Meanwhile" line for the others.

### Ticking off and must-dos

- Each item has a circle; tapping marks it done. Past items fade but aren't auto-ticked. Done items feed the recap.
- Items can be date-only ("Anytime" on that day) or have no day yet (a trip-level wishlist).
- Suggestions: 3–5 must-dos for the destination, shown in Trip prep and on free days, each with [+ Add] / [×]. Accepted ones go to a day (or the wishlist); dismissed ones never come back.

### Tickets and documents (offline)

- When a booking email has a PDF (ticket, boarding pass, voucher), save it with the event (`gmail.readonly` already allows attachments).
- Users can attach a PDF, photo or screenshot to any item.
- The event shows a 🎫 chip that opens a full-screen viewer at max brightness (for QR scanning at gates).
- Files stay on the phone (app-private storage, deleted on wipe / sign-out, not in the backup or shared-trip sync). Never stored online.
- Group visibility: only a label syncs ("🎫 Voucher · on Suhas's phone"). To get a copy: (A) the holder shows it, or (B) the holder sends it through the share sheet (WhatsApp, Nearby Share, AirDrop) and "Open with NomadSafe" attaches it to the matching item. An "Ask for it" push ("Pranav needs the hotel voucher") prompts the holder. Received copies don't update ("copy from Suhas, 12 Oct").
- Boarding passes are private by default; a "Visible to the group" switch shares the label.

## Data changes

- Time zones: show events in the destination's local time. Gmail times are local wall-clock with no zone attached; form times are instants. Store local time + IANA zone per event; get the zone from destination coordinates.
- `TripEvent`: optional place (name + coords, via `findPlaceByName`) for the Maps button; `people?: string[]` (member ids like splits; empty = everyone); `doneAt?`; date-only / no-date items; `attachments?` (local file refs, never synced); types `food`, `note`.
- Live `now`: update on a timer and on app foreground (today it's frozen at mount in `TripItinerary`).
- Must-do suggestions: bundled per-city list, generated by a script like the other bundled data.

## Analytics

Counts, enums and booleans only.

Baseline (ship before the feature):
- `home_viewed { stage, events_today, trip_events }`: once per app foreground
- `itinerary_sheet_opened { events }`
- `itinerary_event_added { source: manual | gmail, count }`
- `itinerary_event_edited { source }` / `itinerary_event_deleted { source }`

With the feature:
- `itinerary_day_viewed { relative_day, via: rail | swipe }`
- `today_action { action: maps | add_stop | expand | tomorrow | ticket | done }`
- `must_do_suggestion { action: shown | added | dismissed, count }`
- `attachment_added { source: gmail | file | photo }`

## Interview guide (~30 min, 5–6 people)

Screener: back from a trip of 4+ days in the last 3 months; mix of solo and group.

1. Walk me through the morning of day 3. What did you open first?
2. Where did the plan live: notes, screenshots, Gmail, a spreadsheet, WhatsApp?
3. Tell me about a time the plan went wrong or you couldn't find a booking or ticket.
4. (Group) How did you know what the others were doing? Did you split up?
5. Were you ever offline when you needed the plan or a ticket?
6. Did you use a must-see list? Where did it come from?
7. Show the "During" sketch: what's missing, and what would you remove?

## Open questions

See the latest discussion; resolved answers move to "Decisions so far".
