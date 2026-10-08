import type { ReactNode } from "react";

const CARDS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Encrypted on your phone",
    body: "Trips, money and plans are stored encrypted on your device, with the key kept in your phone's keystore.",
    icon: (
      <>
        <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
        <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        <circle cx="12" cy="15.5" r="1.4" />
      </>
    ),
  },
  {
    title: "Backup is your choice",
    body: "Back up your trips to your account to move to a new phone, or keep them only on this one.",
    icon: (
      <>
        <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.7 4.7 0 0 0 7 18.5Z" />
        <path d="m9.5 13.5 2 2 3.5-4" />
      </>
    ),
  },
  {
    title: "Your inbox stays home",
    body: "Booking emails from Gmail are read on your phone. Their text is never uploaded.",
    icon: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
        <path d="m4.5 7 7.5 6 7.5-6" />
      </>
    ),
  },
  {
    title: "Photos and steps stay put",
    body: "The photos picked for your replay and your step counts are never uploaded.",
    icon: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
        <circle cx="9" cy="10" r="1.8" />
        <path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" />
      </>
    ),
  },
];

export function PrivacyBand() {
  return (
    <section className="band" aria-labelledby="privacy-title">
      <div className="wrap">
        <div className="band__head reveal">
          <p className="eyebrow">Private by design</p>
          <h2 id="privacy-title">Your trip is yours.</h2>
        </div>
        <ul className="privacy-grid">
          {CARDS.map((card) => (
            <li key={card.title} className="glass privacy-card reveal">
              <span className="privacy-card__icon">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  {card.icon}
                </svg>
              </span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </li>
          ))}
        </ul>
        <p className="band__link reveal">
          <a href="/privacy">
            Read the privacy policy <span aria-hidden="true">→</span>
          </a>
        </p>
      </div>
    </section>
  );
}
