# Everyday NomadSafe: groups, everyday safety, year-round use

Status: Phase 1, its Plus/Pro extras and Phase 1b (import) implemented on `feature/everyday-groups` (2026-10-07). Phases 2–3 are next.

## Why

Most people travel 2–4 times a year, so a trip-only app is opened ~30 days a year and uninstalled in between. Most of what NomadSafe already has (splits, shared groups, live location, check-ins, SOS, recap) is useful without a trip; it's just locked inside one.

**Positioning:** for the people you go places with, every day and on trips.

## The one rule

While a trip is active, the app behaves as it does today. Home (Today view, trip pass), Safety, itinerary, globe, recap and Gmail sync stay trip-first. Everyday features sit alongside the trip and never replace it.

A group can never be the active trip, and code that needs trip details takes a `Trip`, which a plain group can't be passed as. Together these keep groups out of every trip feature, and the compiler catches any place that's missed.

The app isn't live yet, so there are no older versions or user data to stay compatible with.

## Phases

1. **Groups, the Money redesign and an everyday Home**: Splitwise-style groups outside trips. It brings people back weekly, and every invite link brings in someone new. Home gets balance and "Get home safe" cards when there's no trip.
1b. **Import from Splitwise and Settle Up**: right after Phase 1. Bring a group's history or just its balances over from a file.
2. **Trips that set themselves up**: suggested from booking emails; weekend getaways count, so the passport fills up all year.
3. **Memories**: "A year ago today" reminders and a December year-in-travel recap with a share video.

**Everyday safety is already built.** The map-first Safety tab has no link to trips: the safe-arrival timer is "Get home safe", and the circle (share location, per-person pause, SOS and missed-timer pushes) is the family circle. What's left is small and goes into Phase 1 (the Home card) or later polish:
- a "Get home safe" home-screen widget next to the SOS and voice widgets
- possibly a longer share for family. Shares end after 8 h today, a deliberate battery choice, and that stays unless we decide otherwise.

## Phase 1 spec

### Model: a trip is a group with travel details

The basic thing is a **group**: people, a currency, expenses, payments, and optional sharing. A **trip** is a group that also has travel details. "Circle" stays the Safety word; money uses "group".

- **Types:**
  - `Group`: `id`, `name`, `emoji?`, `currency`, `companions`, `budget`, `shared?`, `createdAt`.
  - `Trip = Group & { startDate, endDate, destinations, destinationCoordinates?, mode }`. Trip fields stay flat, so `trip.startDate` doesn't change.
  - `isTrip(group)` tells them apart.
- **Store:** `trips` and `groups` are kept as two lists. Trip code keeps reading `trips` and can never see a group; money code reads both through `selectMoneyGroups` / `findMoneyGroup`, and sync writes both through `setMoneyGroups`.
- **Money code takes a `Group`:** balances, settle-up, splits, voice, group sync, money pushes and the AI money facts. Trips get all of it for free. (`TripBalances` becomes `GroupBalances`, and so on.)
- **Trip-only code takes a `Trip`:** Home's Today view, Trip prep and must-dos, the trip pass and `travelInfoStore`, itinerary and tickets, the globe and weather, recap, passport, the recap notification, Gmail sync and "days left".
- **Trips tab:** shows trips only. Groups live in Money.
- **Groups are never the active trip.** `pickDefaultActiveTripId` and every `setActiveTrip` caller take only trips.
- **Free count:** owned trips and owned groups are counted separately.
- **Notification taps:** `useGroupNotificationRouting` makes a tapped trip active before opening Money; a tapped group opens its money screen and leaves the active trip alone.
- **Names follow the model:** backend tables and functions are named for groups (`sharedGroups`, `groupMembers`, `groupRecords`, `api.groups.*`), and expenses and payments point to a `groupId`. Personal backup uses sync kind `"trip"` for trips and `"group"` for groups. `/join/<code>` links and invite codes don't change.
- **Joining a group:** the invite preview (`previewInvite`) and `JoinTripScreen` show a group with no dates.

### Moving between trips and groups

- **Money switcher:** the Overview is the Money home (titled "Money"), not an entry in the list. A trip or group has a "‹ Overview" back link, and its name ("Goa trip ▾") lists the active trip and your groups (most recent activity first), then ended trips. Switching doesn't change the active trip. The header's only button is ⋯ (people, settings, import, export).
- **Where an expense goes:** the add-expense sheet has an "in: Goa trip ▾" chip. It defaults to the screen you're on (the trip or group on screen; on the Overview, the same default as voice: the active trip, else the first trip or group), so the flat's rent can go in mid-trip without leaving.
- **Move to…:** an option on an expense, for when it went into the wrong group or trip. Moving an expense out of a shared group deletes it there and adds it to the new one, through the existing sync.
- **Voice and the widget** can pick any group or trip.
- **Plan a trip with this group:** a button on the group screen that starts a trip with the same people.
  - **Shared group:** the people who joined it are added to the new shared trip straight away (a new server mutation, owner only), and they get a push: "Rahul added you to Goa trip". People in the group who never joined are carried over as names.
  - The new trip counts toward the free trip limit as usual.
- **Keep as a group:** offered when a trip ends. It starts a new group with the trip's people (and, on a shared trip, its joined members, added the same way). The trip stays a trip, with its recap and passport. Unsettled trip balances stay on the trip.

### AI tab context

Chats are already kept per trip (conversation key = trip id), alongside a General and a temporary chat. Groups work the same way.

- **Default context when the AI tab opens:**
  1. the active trip, if there is one
  2. otherwise the group with the most recent activity: an expense or payment added by you or anyone else, or the group being created or joined
  3. otherwise General
- **Context picker:** a dropdown in the AI header lists the active trip, groups (recent first), other trips, "Overview" (everything, as on the Money Overview) and General. Picking one changes only the chat's context, never the active trip.
- **Reset:** leaving the AI tab and coming back resets it to the default. Backgrounding the app while on the AI tab keeps the pick.
- **Separate chats:** every group and trip has its own conversation, plus General. The temporary chat works on top of whatever context is picked. Deleting a group or trip removes its chat (`removeConversation`, as for trips today).
- **Chats are personal:** a shared group's chat is never shared with its members.
- **Facts follow the picked context, not the active trip:**
  - `loadTripMoneySnapshot` takes the context id.
  - For a group, the facts are its totals, categories, recent spends, each person's balance and the simplified "who pays whom". These are pre-computed, so the model still does no arithmetic.
  - For a trip, the facts stay as today, with balances added.
  - Gmail merchants stay hidden from online AI, as today.
- **On-device and free:** chat on the on-device model stays free for everyone. Pro only adds the cloud model.

### Money tab

The Money tab has an **Overview** (Money home), plus one money screen per trip or group. There is no separate Personal screen: personal spending is part of the Overview. The Overview is about you across everything; a trip or group screen is about that one place, with everyone in it.

- **Active trip:** opens on that trip's money screen, as today. "‹ Overview" goes back to the Overview; the switcher lists the active trip and groups (most recent first), then ended trips.
- **No active trip:** opens on the Overview. From top to bottom:
  1. **Your spending:** a Week / Month switch with arrows for earlier periods, and the total of everything you spent, in the home currency (see Personal spending). Under it, "where it went": one row per trip, group and "Not in a group", each opening that trip or group. Then the category bar.
  2. **Balance:** "You're owed ₹3,450 overall" (or "You owe…"), hidden when everything is settled.
  3. **Trips and groups:** mixed together, sorted by most recent activity, with a badge on trips and your balance in each. Anything settled for 30+ days folds into a collapsed "Settled" section.
  4. **Your spends:** activity for spends that aren't in any trip or group (`groupId: null`). Spends land here when "Not in a group" is picked in the add sheet.
- The **Trip mode** switch in Settings is removed (`tripModeEnabled`, `defaultTripMode`). Trip focus turns on by itself while a trip is active.

### Where the app opens

It's automatic, with no setting.

- **Trip active:** opens on Home, as today.
- **No active trip:** opens on Home until the habit says otherwise:
  - **Switch to Money:** if Money was opened in each of the last 2 sessions with no active trip, the app opens on Money from the 3rd session on.
  - **Switch back to Home:** while opening on Money, if in 2 sessions in a row the user leaves Money within a few seconds without using it (no scroll, opening a group, adding or settling), the app goes back to opening on Home.
  - **Same rule every time:** after switching back to Home, 2 more sessions with a Money visit switch it to Money again. The two rules simply keep applying, with no extra steps.
  - **Trips reset it:** a trip becoming active resets both counts. When it ends, counting starts again from zero on Home.
- **Session:** a launch, or coming back after 30+ minutes in the background (`SESSION_TIMEOUT_MS`, the same definition the ad rules use). A short app switch keeps the current screen.
- **Taps that go somewhere specific win:** notifications, widgets (SOS, voice, balance), invite and `/join` links, onboarding and the SOS countdown always go where they point. The automatic landing only applies to a plain launch or a new session.
- **Where the logic lives:**
  - The rule is a pure function in `src/utils` (session history in, tab out), with tests.
  - The small counter state goes in encrypted MMKV, through the usual store.
- **Analytics:** an `app_landing` event with the tab and the reason (`trip`, `habit`, `link`). No content.

### Home when there's no trip

Home keeps the globe and adds two small cards under it. During a trip, Home stays as it is today.
- **Balance:** "You're owed ₹3,450 across 3 groups" (or "You owe…"), which opens Money. It's hidden when everything is settled and there are no groups.
- **Get home safe:** starts the safe-arrival timer sheet (`SafeArrivalSheet`). While a timer is running, the card shows the live countdown instead.

### Trip / group money screen

Trips and groups share the same structure:

1. **Header:** name, people avatars, and a "+" to add a person or share the invite. People can be managed from Money, not only from Trips.
2. **Balance hero:** your balance, then one row per person with a Settle button. The spend figure is **your spend** (see Personal spending).
   - A solo trip with no people keeps today's spend hero, plus a prompt to add people.
3. **Activity:** expenses and payments by day. Each row shows who paid and "you lent ₹X / you borrowed ₹Y".
4. **Insights:** a collapsed card with the category bar, budget, and days left (trips only).

### Personal spending

Personal spending is planned explicitly, in three cases:

- **Solo trip:** a trip doesn't need people.
  - Its money screen focuses on spending: total, budget left, days left, categories and activity. There are no balances or Settle buttons.
  - The add sheet has no split line.
  - A small "Add people" link sits in the header. Once someone is added, balances appear.
- **"Just me" in a trip or group:** the split line offers "Just me". The spend stays on that trip or group, is never sent to other members (as today: unsplit spends on a shared trip stay in the personal backup), and shows an "Only you" tag.
- **Big number on a trip or group with people:** **your spend**, meaning your share of split expenses plus your "Just me" spends. The budget compares against it, and the group total shows smaller underneath.

**What counts as your spending** (one rule, used everywhere):
- A personal or "Just me" spend counts in full.
- A split expense counts only your share, whoever paid. Paying ₹3,000 for four people's dinner is ₹750 of your spending.
- Settle-up payments never count.
- The rule is a pure function next to `split.ts`, with tests.

**On the Overview** (not a separate screen), the "Your spending" total covers everything:
- spends that aren't in any trip or group
- your shares in every group and trip
- "Just me" spends

It's shown in the home currency (`useHomeCountry()`'s currency, else the phone's), converted with daily rates as elsewhere, with a note for anything that couldn't be converted. It's separate from the balance below it, which is about who owes whom.

**Free vs Plus:** week and month totals with the breakdown are free. Plus adds the charts and insights and export: a trip day by day once it starts, a group month by month once it's a month old, and on the Overview the comparison with the last week or month, the pace, six months stacked by category (tap a month to open it) and the top places.

### Adding an expense

- Amount first, then a sentence that already reads "Paid by **you**, split **equally** with **everyone**". Tapping any bold word changes it.
- The current `SplitEditor` is the detail view behind that tap.
- **Split types (all free):** equal, percent and custom amounts. Percent entry shows "Left to assign" until it reaches 100%; the amounts are worked out in minor units, with any leftover unit going to someone, as in `splitEqually`.
- **Remembering the split type:** `Expense` gains an optional `split: { mode: "equal" | "percent" | "custom", percents?: Record<person, number> }`, so editing reopens the expense the way it was entered ("60% / 40%").
  - Balances still come only from `shares`, so nothing else changes.
  - Group sync maps the person keys in `percents` to member ids.
  - Older expenses with no `split` field are read as equal when `isEqualSplit`, else custom.
- **Several payers:** "Paid by" offers "Several people", where each payer enters what they paid ("Aagam ₹200 + Suhas ₹200"). The amounts must add up to the total.
  - **Data model:** `Expense` gains an optional `payers: { person, amount }[]`. `paidBy` stays for a single payer, so existing data is unchanged.
  - **Balances:** `computeNetBalances` credits each payer their amount.
  - **Group sync:** maps payer names to member ids, like it does for shares.
  - **Rows:** activity shows "Aagam and Suhas paid".
  - **Voice:** single payer only, as today.
  - **Tests:** in the splits test file.

### Out of scope for v1

- Separate one-to-one "Friends" balances. Use a two-person group instead.
- Shared AI chats inside a group.
- Group types (Home / Couple / …).

## Phase 1b: Import from Splitwise and Settle Up

Built right after Phase 1 ships. Moving over is the main thing stopping Splitwise users from switching, so importing removes it. It's free, but the free limit of 2 groups still applies.

### Entry points and flow

- **Entry points:**
  - "Start from Splitwise / Settle Up" when creating a group: it creates the group with the people from the file.
  - "Import spends" in a group's menu.
- **The flow:**
  1. **Pick the file** with the system file picker. No storage permission is needed, and the file is read on the phone.
  2. **"Which one is you?"** Pick your name from the people in the file.
  3. **Match people:** each name in the file is linked to a group member or added as a new person. On a shared group, new people are added as pending names. Splitwise marks former members "(removed)"; that suffix is dropped and they're shown as former members.
  4. **Preview:** the number of spends and payments, the date range, and each person's final balance. For Splitwise this is checked against the file's `Total balance` row ("Matches Splitwise ✓"). For Settle Up, which has no total row, the computed balances are shown to compare with the app.
  5. **Choose what to bring:**
     - **Full history:** every spend and payment.
     - **Just balances:** one "Carried over from Splitwise / Settle Up" entry per person.
- **No duplicates:** each imported row gets an `externalId` (source + a hash of the row), so importing the same file twice, or two members importing, adds nothing.
- **Categories:** Splitwise names and Settle Up emojis are mapped to ours where they clearly match; otherwise the category is guessed from the text with the existing heuristic.
- **Split type:** equal shares (within a rounding unit) import as an equal split; anything else as custom amounts. Neither export records percentages, so percent splits come in as their amounts. Imported splits keep their mode (equal or custom).
- **After importing:** a nudge to "Invite the group", and the `expenses_imported` ad placement.

### File formats (checked against real exports, 2026-10-07)

**Splitwise CSV:**
- **Encoding and parsing:** UTF-8. Needs a real CSV parser, because descriptions can contain commas.
- **Columns:** `Date, Description, Category, Cost, Currency`, then one column per person with their **net** for that row (positive: lent, negative: owes). Every row nets to 0.
- **Payments:** category `Payment`. The payer is the positive column, the receiver the negative one.
- **Dates:** date only, no time.
- **Ending:** the last row is `Total balance`, with blank lines around it.
- **Single payer** (most rows): rebuilt exactly. The payer is the one positive column, and each share is minus that person's net (the payer's share is cost minus their net).
- **Several payers** (several positive columns, about 3% of rows): the export doesn't say what each paid. Imported as one expense with several payers. Each non-payer's share is minus their net; the payers' remaining share is assumed equal among them, and each payer's paid amount is then their share plus their net. The total and everyone's balance stay exact.
- **All-zero rows:** personal spends; the export doesn't say whose. Skipped by default. The preview lists them so the user can tick the ones that were theirs, which are added as "Just me" spends.
- **Other currencies:** each row carries its own `Currency`. Expected to have one `Total balance` row per currency, but not seen in a sample yet.

**Settle Up CSV:**
- **Encoding:** **UTF-16 with a BOM**. The importer must detect the encoding (UTF-16 or UTF-8).
- **Columns:** `Who paid, Amount, Currency, For whom, Split amounts, Purpose, Category, Date & time, Timezone, Exchange rate, Converted amount, Type, Receipt`. Lists inside a field are separated by `;`.
- **Several payers are exact:** `Who paid = "A;B"`, `Amount = "200;200"`.
- **Payments:** `Type = transfer` ("Who paid" pays "For whom"), imported as settlements.
- **Rounding:** shares can miss the total by a rounding unit (3 × 118.33 against 355). The leftover goes to someone, as in `splitEqually`.
- **Other fields:**
  - Categories are emojis, often blank.
  - Names may be first names only.
  - An empty timezone means phone time.
- **Other currencies:** `Exchange rate` and `Converted amount` are filled for other currencies. Keep the original amount and currency. Not seen in a sample yet.

**Where the code goes:** pure parsers in `features/expenses/utils/` (format detection, parsing, rebuilding shares), with tests against anonymised copies of the real exports.

## Plans and ads

### Limits

| | Free | Plus / Pro |
|---|---|---|
| Owned trips | 2 | Unlimited |
| Owned groups | 2 | Unlimited |

- Trips and groups people invite you to don't count toward your limit, and spends that aren't in any trip or group never count against anything.
- Deleting a group frees a slot; archiving one doesn't.
- A third group opens the paywall with a `groups` reason, the same way `useStartNewTrip` works for trips.
- The client rule goes in `modules/billing/plan.ts`. `convex/billingRules.ts` should match it if the server enforces it.

### Plus features for everyday use

- recurring expenses (rent, subscriptions)
- "shares" splits (e.g. 2:1 for a couple with a kid) and saved presets (e.g. "Flat 60/40")
- spending charts per group and over time
- CSV/PDF export
- receipt scanning with the on-device model
- no ads

**Pro** adds itemised receipt splits ("Rahul had the pasta") and cloud AI in the chat. Asking about your spending in a group or trip is the AI tab with that context, and stays free on the on-device model.

Free keeps:
- equal, percent and custom splits, and several payers
- settle up and balances
- basic search
- a balance widget

### Ads

Interstitials go through the existing rules in `modules/ads/rules.ts`, tunable with the `ad_frequency` flag:
- **Settling up:** after recording a payment (`settlement_recorded`, every time).
- **New groups:** after creating a group (new placement `group_created`, every time).
- **Adding expenses:** at most 1 per 5 saved expenses (`expense_saved`, today every 4th), with at least 3 minutes between ads (`gapSeconds`), plus the existing per-session and per-day caps.

### Never charged for, never ads

Safety: SOS, check-ins, "Get home safe", alerts and the circle. Voice and lock screens also stay ad-free, as today.

## Open for later phases

- **Safety polish:** the "Get home safe" widget, and whether family shares can last longer than 8 h. Any new background location request still needs `BackgroundLocationDisclosure` first.
- **Phase 2:** a trip suggestion from Gmail bookings (the booking parsing in `tripGmailSync` already finds flights and stays). Photos come only through the system picker (media permissions are blocked), so the app can't scan the library for past trips. Photo-based suggestions would mean the user picks photos and we read their EXIF locations, as the recap does.
- **Phase 3:** "A year ago today" notification timing, and the year-in-travel recap built on the recap video pipeline (steps and photos stay on the phone and off the share card, as in the recap).
