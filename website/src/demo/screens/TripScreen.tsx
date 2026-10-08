import { useState } from "react";
import { TODAY, type ItineraryItem } from "../data/demo";
import { Icon, type IconName } from "../icons";
import { PhoneGlobe } from "../PhoneGlobe";

const KIND_ICON: Record<ItineraryItem["kind"], IconName> = { food: "fork", activity: "compass", transit: "tram", stay: "bed" };

interface TripScreenProps {
  globe: boolean;
  compact: boolean;
  active: boolean;
  announce: (text: string) => void;
}

export function PassCard() {
  return (
    <div className="mpass">
      <span className="mpass__aura" />
      <span className="mpass__foil" />
      <div className="mpass__row">
        <span>Portugal · Day 4/9 · Lisbon</span>
        <span className="mpass__status">
          <i /> Not sharing
        </span>
      </div>
      <p className="mpass__label">Tonight</p>
      <p className="mpass__title">Memmo Alfama</p>
      <p className="mpass__sub">Night 4 of 5</p>
      <div className="mpass__stub">
        <span className="mpass__time">10:30</span>
        <span className="mpass__next">
          in 47 min
          <small>Jerónimos</small>
        </span>
      </div>
    </div>
  );
}

function DayRail() {
  return (
    <div className="mrail" aria-hidden="true">
      <div className="mrail__ticks">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={i === 3 ? "is-today" : i < 3 ? "is-past" : undefined} />
        ))}
      </div>
      <div className="mrail__labels">
        <span>Oct 6</span>
        <span>Oct 14</span>
      </div>
    </div>
  );
}

/** The app's Home during a trip: globe, weather and day chips, the trip pass, the day rail and today's plan. */
export function TripScreen({ globe, compact: initialCompact, active, announce }: TripScreenProps) {
  const [compact, setCompact] = useState(initialCompact);
  const [done, setDone] = useState(() => new Set(TODAY.filter((i) => i.done).map((i) => i.id)));

  const toggle = (item: ItineraryItem) => {
    const next = new Set(done);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    setDone(next);
    announce(`${item.title} ${next.has(item.id) ? "done" : "not done"}`);
  };

  return (
    <div className={`mtrip${compact ? " is-compact" : ""}`}>
      <div className="mtrip__globe">
        {globe ? <PhoneGlobe enabled={active} /> : <div className="pglobe pglobe--static" />}
        <div className="mtrip__header">
          <span>Good morning, Alex</span>
          <span className="mtrip__header-actions" aria-hidden="true">
            <span className="mround">
              <Icon name="swap" size={17} />
            </span>
            <span className="mround mround--avatar">A</span>
          </span>
        </div>
        <button type="button" className="mround mtrip__collapse" onClick={() => setCompact(true)} aria-label="Show today's plan">
          <Icon name="chevronDown" size={18} />
        </button>
      </div>

      <div className="mtrip__body">
        {compact && (
          <button type="button" className="mtrip__expand" onClick={() => setCompact(false)}>
            <Icon name="chevronDown" size={14} className="flip" /> Map
          </button>
        )}
        <div className="mchips">
          <span className="mchip">
            <Icon name="sun" size={14} className="sunny" /> 25° · Clear
          </span>
          <span className="mchip">
            <Icon name="clock" size={14} /> Day in Lisbon · sunset in ~9 h 30 min
          </span>
        </div>
        <div className="mchips mchips--center">
          <span className="mchip">
            <Icon name="users" size={14} /> 2 people sharing with you
          </span>
        </div>
        <PassCard />
        <DayRail />
        <div className="mtoday__head">
          <span>Today</span>
          <span className="mpill" aria-hidden="true">
            <Icon name="plus" size={14} /> Add
          </span>
        </div>
        <ul className="mtoday">
          {TODAY.map((item) => {
            const isDone = done.has(item.id);
            return (
              <li key={item.id} className={`mtoday__item mtoday__item--${item.kind}${isDone ? " is-done" : ""}`}>
                <span className="mtoday__time">{item.time}</span>
                <span className="mtoday__icon">
                  <Icon name={KIND_ICON[item.kind]} size={17} />
                </span>
                <span className="mtoday__text">
                  <strong>{item.title}</strong>
                  <small>{item.sub}</small>
                </span>
                <span className="mround mround--small" aria-hidden="true">
                  <Icon name="pin" size={15} />
                </span>
                <button
                  type="button"
                  className="mcheck"
                  aria-pressed={isDone}
                  aria-label={`${item.title}: mark ${isDone ? "not done" : "done"}`}
                  onClick={() => toggle(item)}
                >
                  {isDone && <Icon name="check" size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
