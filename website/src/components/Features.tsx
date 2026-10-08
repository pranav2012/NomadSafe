import { Feature } from "./Feature";
import { Phone } from "./Phone";

export function Memories() {
  return (
    <Feature
      id="memories"
      index="01"
      label="Memories"
      title="Come home with a story, not just a camera roll."
      glow="violet"
      points={[
        { title: "Your trip, replayed.", body: "Watch your route draw itself stop by stop on a map, set to music." },
        {
          title: "The best photos, picked for you.",
          body: "Choose your photos and NomadSafe picks the best few for each stop, right on your phone.",
        },
        { title: "Share it your way.", body: "Send a short video of the replay or a story card of the trip." },
        {
          title: "A passport that fills itself.",
          body: "A stamp for every country you visit, and seals for the states you explore at home.",
        },
      ]}
      media={
        <div className="phone-pair">
          <Phone className="phone--back" src="/screens/passport.png" alt="The NomadSafe passport with country stamps." />
          <Phone
            className="phone--front"
            src="/screens/replay.png"
            alt="A trip replay drawing the route between stops on a map."
          />
        </div>
      }
    />
  );
}

export function Planning() {
  return (
    <Feature
      id="planning"
      index="02"
      label="Planning"
      title="Your days, sorted before you land."
      glow="teal"
      flip
      points={[
        {
          title: "A plan for every day.",
          body: "Connect Gmail and your bookings land on the right day. The emails are read on your phone.",
        },
        {
          title: "Tickets in your pocket.",
          body: "Booking PDFs and boarding passes stay on your phone and open offline, bright enough for the gate scanner.",
        },
        {
          title: "Save ideas as you scroll.",
          body: "Share a reel or a link to NomadSafe and it's saved to your trip, next to the must-see sights nearby.",
        },
        {
          title: "Destination essentials.",
          body: "Time difference, plugs, emergency numbers, the nearest hospital, your embassy, and a “Show to driver” card with your stay's address in the local language.",
        },
      ]}
      media={
        <Phone src="/screens/itinerary.png" alt="Today's plan in NomadSafe: a trip pass with tonight's stay and a timeline of the day's stops." />
      }
    />
  );
}

export function Money() {
  return (
    <Feature
      id="money"
      index="03"
      label="Money"
      title="Split it fairly. See where it went."
      glow="indigo"
      points={[
        {
          title: "Budgets that keep pace.",
          body: "See your daily pace against the trip budget and what's left to spend each day.",
        },
        {
          title: "Split with friends.",
          body: "Equal, by percent or custom amounts, in trips or everyday groups, then settle up in as few payments as possible.",
        },
        {
          title: "Less typing.",
          body: "Scan receipts, convert currencies automatically, and bring your history over from Splitwise or Settle Up.",
        },
        { title: "Spending insights.", body: "Where your money went, how this month compares, and your biggest spends." },
      ]}
      footnote="Spending insights, receipt scanning, recurring spends and export come with Plus."
      media={
        <Phone src="/screens/money.png" alt="The Money tab with a trip budget, daily pace and balances with friends." />
      }
    />
  );
}

export function Safety() {
  return (
    <Feature
      id="safety"
      index="04"
      label="Safety"
      title="Help is one hold away."
      glow="rose"
      flip
      points={[
        { title: "Hold for SOS.", body: "Your circle gets a push notification right away and can see where you are." },
        {
          title: "Live location, on your terms.",
          body: "Share only with the people you choose. Pause anyone, or stop any time.",
        },
        {
          title: "Safe-arrival timer.",
          body: "Set when you expect to arrive. If you don't check in, your circle is alerted.",
        },
      ]}
      footnote="Alerts are push notifications to people in your circle who use NomadSafe; NomadSafe doesn't send SMS or contact emergency services. In an emergency, call your local emergency number."
      media={
        <Phone
          src="/screens/safety.png"
          alt="The Safety tab: a map of people sharing with you and a hold-to-SOS button."
        />
      }
    />
  );
}

export function Features() {
  return (
    <>
      <Memories />
      <Planning />
      <Money />
      <Safety />
    </>
  );
}
