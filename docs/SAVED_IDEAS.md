# Saved ideas, sharing in and planned trips

Agreed 2026-10-07. Saved ideas are a trip's ideas, never its plans.

## Saved ideas (free)

- An idea is a wishlist itinerary event (`timing: "wishlist"`). It has no time and never shows on the timeline, Up next or the day plan. "Plan for a day" turns it into an "anytime" item on that day.
- Optional fields:
  - `savedBy`: who saved it. Locally `SELF_ID` or a member name; on the server, a member id (mapped like `people`).
  - `place`: name and coordinates. Must-dos carry theirs; other ideas can be pinned to a place later.
  - `link`: phase 3.
- Ideas look different from plans: dashed outline, bookmark icon, no time.
- On shared trips everyone sees the ideas, labelled "Saved by Sam". They sync as group `event` records and count toward the group record cap.

### Where ideas show

| Stage | Where |
|---|---|
| Before the trip | "Before you go": "🔖 N saved ideas ›" and "★ N must-dos in Tokyo ›", both opening the Saved sheet |
| During the trip | Under the day's plan: "Your ideas in Kyoto" (ideas whose place is near that day's stop, up to 3, "Add to today", "See all N ideas ›"), then "Popular here" (up to 2 must-dos). Both show every day. The day header has a 🔖 N button. |
| Full itinerary | Ideas first, as dashed rows |

### Saved sheet

- Two tabs: **Your ideas** and **Popular** (the must-dos).
- Place filter chips: All, one per stop, and "No place".
- Cards in two columns. Tapping a card offers Plan for a day / Remove.
- Saving a must-do shows the toast "Saved to <trip> ideas" with a **View** action.

## Planned trips (phase 2)

- A trip being considered. Needs a name or a place; dates are optional or rough ("Sometime in March").
- Never the active trip. No safety features, alerts, recap, passport stamps or money until it's confirmed.
- **Confirm** sets real dates and applies the free plan's 2-trip limit. The free plan allows up to 3 planned trips.
- **Discard** asks whether to move its ideas to another trip or delete them.
- Invites use the same link, so friends can collect ideas together.
- Looks: a dashed outline of the pass, with the name in outline lettering, a "PLANNING" label, an idea thumbnail strip and a "Confirm trip" button. On the globe, a hollow dashed pin.
- Where it shows: a "Planning · N of 3 free" section in the Trips tab, and on Home only when there's no confirmed trip (a sideways row under the search).
- Creating one: there's one flow for both kinds (Home "Where next?", Trips "New trip"). At the dates step, "Not sure of dates yet" offers a rough time (Any time, this month, a later month) and "Save as planned trip". Choosing dates creates a confirmed trip, as it does today.
- A destination is optional: pick a place from search, or just type a name ("Europe summer"). With no place there's no globe pin and no must-dos until one is added.
- Confirming opens the same date picker, starting on the rough month if one was set.

### Shared planned trips (phase 2b)

- Invites use the same link and flow as trips. Joined planned trips don't count toward a member's limits.
- Only the owner can confirm. Members see who they're waiting on to confirm. Only the owner's 2-trip limit applies.
- Confirming updates the trip for everyone. Members get a push ("Sam confirmed Bali · Mar 3–10"), and it becomes their upcoming trip.
- Saved ideas send batched pushes to the other members, at most one every few hours ("Sam saved 3 ideas to Bali").
- Members can leave. The owner can discard it for everyone after a confirmation, with no settle-up step since there's no money.

## Sharing in (phase 3, new native build)

- Android share target and iOS Share Extension. Accepts Instagram reels and posts, TikTok, YouTube Shorts and any link.
- The "Save to" sheet lists the active trip, then upcoming trips, then planned trips, then "+ New planned trip". You can add an optional note.
- A shared link waits behind the PIN lock, the same way incoming tickets do.
- Detecting the place, on the phone with no AI: take the link's title (YouTube and TikTok oEmbed, the page title for links, any caption text that comes with the share) and match it against the bundled city and country names.
- The save sheet is always shown first, pre-filled, and saving takes one tap:
  - a place is found and a planned or upcoming trip there exists → "Save to: <trip>"
  - a place is found but no trip is there → "New planned trip · <place>" (editable)
  - nothing is found (most Instagram reels) → "Where is this?": a search field with your trips listed underneath; you must choose before saving.
- During an active trip, the detected place wins (a Bali reel shared in Tokyo goes to the Bali planned trip). With no place found, it falls back to the active trip.
- Shares about the same place reuse the same planned trip, matched by place. When the free plan's 3 planned trips are used up, the sheet offers the existing ones and Plus.

## Previews (phase 4, same build)

- Reels and videos play in the app through `react-native-webview` embeds. Other links open in the in-app browser.
- Thumbnails:
  - TikTok and YouTube: their public oEmbed.
  - Links: Open Graph tags.
  - Instagram: a frame captured on first play. Instagram serves Open Graph tags only to Meta's crawlers, so we never fake their user agent. Switch to Meta oEmbed once the app review is approved.
- Keep a local copy of each thumbnail, because CDN image links expire.
- Privacy copy and the Play data safety form: reels and previews load from Instagram, TikTok, YouTube or the linked site.
