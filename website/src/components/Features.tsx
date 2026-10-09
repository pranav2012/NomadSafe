import type { ReactNode } from "react";
import { ClipPhone } from "./ClipPhone";
import { DemoPhone } from "./DemoPhone";

interface FeatureProps {
  id: string;
  index: string;
  label: string;
  title: string;
  points: { title: string; body: string }[];
  footnote?: string;
  glow: "violet" | "teal" | "indigo" | "rose";
  flip?: boolean;
  phone: ReactNode;
}

function Feature({ id, index, label, title, points, footnote, glow, flip, phone }: FeatureProps) {
  return (
    <section id={id} className={`feature${flip ? " feature--flip" : ""}`} aria-labelledby={`${id}-title`}>
      <div className="wrap feature__grid">
        <div className="feature__copy reveal">
          <p className="eyebrow">
            <span className="eyebrow__index">{index}</span>
            {label}
          </p>
          <h2 id={`${id}-title`}>{title}</h2>
          <ul className="points">
            {points.map((p) => (
              <li key={p.title}>
                <strong>{p.title}</strong> <span className="points__body">{p.body}</span>
              </li>
            ))}
          </ul>
          {footnote && <p className="footnote">{footnote}</p>}
        </div>
        <div className="feature__media">
          <div className={`halo halo--${glow}`} aria-hidden="true" />
          {phone}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <>
      <Feature
        id="memories"
        index="01"
        label="Memories"
        title="Come home with a story, not just a camera roll."
        glow="violet"
        points={[
          { title: "Your trip, replayed.", body: "Watch your route draw itself stop by stop on a map, set to music." },
          { title: "The best photos, picked for you.", body: "Choose your photos and NomadSafe picks the best few for each stop, right on your phone." },
          { title: "Share it your way.", body: "Send a short video of the replay or a story card of the trip." },
          { title: "A passport that fills itself.", body: "A stamp for every country you visit, and seals for the states you explore at home." },
        ]}
        phone={<ClipPhone clip="passport" label="Recording of the NomadSafe passport: the cover opens and a page turns to show country stamps." hint="Recorded in the app" />}
      />
      <Feature
        id="planning"
        index="02"
        label="Planning"
        title="Your days, sorted before you land."
        glow="teal"
        flip
        points={[
          { title: "A plan for every day.", body: "Connect Gmail and your bookings land on the right day. The emails are read on your phone." },
          { title: "Tickets in your pocket.", body: "Booking PDFs and boarding passes stay on your phone and open offline, bright enough for the gate scanner." },
          { title: "Save ideas as you scroll.", body: "Share a reel or a link to NomadSafe and it's saved to your trip, next to the must-see sights nearby." },
          {
            title: "Destination essentials.",
            body: "Time difference, plugs, emergency numbers, the nearest hospital, your embassy, and a “Show to driver” card with your stay's address in the local language.",
          },
        ]}
        phone={<DemoPhone tabBar={false} label="Demo: today's plan on a trip" tab="trip" tripCompact hint="Tick off today's plan" />}
      />
      <Feature
        id="money"
        index="03"
        label="Money"
        title="Split it fairly. See where it went."
        glow="indigo"
        points={[
          { title: "Budgets that keep pace.", body: "See your daily pace against the trip budget and what's left to spend each day." },
          { title: "Split with friends.", body: "Equal, by percent or custom amounts, in trips or everyday groups, then settle up in as few payments as possible." },
          { title: "Less typing.", body: "Scan receipts, convert currencies automatically, and bring your history over from Splitwise or Settle Up." },
          { title: "Spending insights.", body: "Where your money went, how this month compares, and your biggest spends." },
        ]}
        footnote="Spending insights, receipt scanning, recurring spends and export come with Plus."
        phone={<DemoPhone tabBar={false} label="Demo: a shared group's balances" tab="money" hint="Add a spend and watch the balances" />}
      />
      <Feature
        id="safety"
        index="04"
        label="Safety"
        title="Help is one hold away."
        glow="rose"
        flip
        points={[
          { title: "Hold for SOS.", body: "Your circle gets a push notification right away and can see where you are." },
          { title: "Live location, on your terms.", body: "Share only with the people you choose. Pause anyone, or stop any time." },
          { title: "Safe-arrival timer.", body: "Set when you expect to arrive. If you don't check in, your circle is alerted." },
        ]}
        footnote="Alerts are push notifications to people in your circle who use NomadSafe; NomadSafe doesn't send SMS or contact emergency services. In an emergency, call your local emergency number."
        phone={<DemoPhone tabBar={false} label="Demo: the Safety tab with hold-to-SOS" tab="safety" hint="Hold SOS · demo, nothing is sent" />}
      />
    </>
  );
}
