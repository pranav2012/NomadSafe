import { useMemo, useState } from "react";
import { FLATMATES_NET, FLATMATES_YOUR_SPEND, PEOPLE, type Person } from "../data/demo";
import { Icon } from "../icons";
import { addSpend, formatMoney, simplify, splitEqually, withYou } from "../money";
import { useCountUp } from "../useCountUp";

const NAMES = ["Groceries", "Dinner", "Taxi", "Utilities"];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

function Money({ cents, className }: { cents: number; className?: string }) {
  const shown = useCountUp(cents);
  return <span className={className}>{formatMoney(shown)}</span>;
}

function Avatar({ person }: { person: Person }) {
  return (
    <span className="mavatar" data-person={person.toLowerCase()} aria-hidden="true">
      {person[0]}
    </span>
  );
}

/** Typed amount → cents; at most 2 decimals and $99,999.99. */
function toCents(input: string) {
  const [whole, frac = ""] = input.split(".");
  return Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
}

function AddSpendSheet({ onAdd, onClose }: { onAdd: (cents: number, name: string, people: Person[]) => void; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [name, setName] = useState(NAMES[0]);
  const [people, setPeople] = useState<Person[]>([...PEOPLE]);
  const cents = toCents(input);
  const shares = cents > 0 ? splitEqually(cents, ["You", ...people]) : null;

  const press = (key: string) => {
    setInput((prev) => {
      if (key === "⌫") return prev.slice(0, -1);
      if (key === "." && (prev.includes(".") || prev === "")) return prev === "" ? "0." : prev;
      const [whole, frac] = (prev + key).split(".");
      if (frac !== undefined && frac.length > 2) return prev;
      if (whole.length > 5) return prev;
      return prev === "0" && key !== "." ? key : prev + key;
    });
  };

  const togglePerson = (p: Person) => setPeople((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  return (
    <div className="msheet" role="dialog" aria-label="Add a spend">
      <button type="button" className="msheet__scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className="msheet__panel">
        <span className="msheet__grab" aria-hidden="true" />
        <div className="msheet__head">
          <span>Add a spend</span>
          <button type="button" className="mround" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className={`msheet__amount${input ? "" : " is-empty"}`} aria-live="polite">
          ${input || "0"}
        </p>
        <div className="mchips mchips--wrap" role="group" aria-label="What was it">
          {NAMES.map((n) => (
            <button key={n} type="button" className={`mchip mchip--toggle${n === name ? " is-on" : ""}`} aria-pressed={n === name} onClick={() => setName(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="msheet__summary">
          Paid by <strong>You</strong> · Split <strong>equally</strong>
        </p>
        <div className="mchips mchips--wrap" role="group" aria-label="Split with">
          <span className="mchip is-on is-fixed">
            <Avatar person="You" /> You
          </span>
          {PEOPLE.map((p) => (
            <button key={p} type="button" className={`mchip mchip--toggle${people.includes(p) ? " is-on" : ""}`} aria-pressed={people.includes(p)} onClick={() => togglePerson(p)}>
              <Avatar person={p} /> {p}
            </button>
          ))}
        </div>
        <p className="msheet__preview">
          {shares
            ? people.length > 0
              ? `${formatMoney(shares.get("You") ?? 0)} each · you get back ${formatMoney(cents - (shares.get("You") ?? 0))}`
              : "Just you: no one owes anything"
            : "Type an amount"}
        </p>
        <div className="mkeypad">
          {KEYS.map((k) => (
            <button key={k} type="button" onClick={() => press(k)} aria-label={k === "⌫" ? "Delete" : k}>
              {k}
            </button>
          ))}
        </div>
        <button type="button" className="mbutton" disabled={cents === 0} onClick={() => onAdd(cents, name, people)}>
          Add spend
        </button>
      </div>
    </div>
  );
}

/** The Flatmates group: balances with each person, debts between others, your spend and Add a spend. */
export function MoneyScreen({ announce }: { announce: (text: string) => void }) {
  const [net, setNet] = useState(FLATMATES_NET);
  const [yourSpend, setYourSpend] = useState(FLATMATES_YOUR_SPEND);
  const [adding, setAdding] = useState(false);

  const transfers = useMemo(() => simplify(net), [net]);
  const mine = withYou(transfers);
  const others = transfers.filter((t) => t.from !== "You" && t.to !== "You");

  const add = (cents: number, name: string, people: Person[]) => {
    const result = addSpend(net, cents, people);
    setNet(result.net);
    setYourSpend((s) => s + result.yourShare);
    setAdding(false);
    announce(`Added ${name}, ${formatMoney(cents)}. You're owed ${formatMoney(result.net.You)}.`);
  };

  const settle = (person: Person, cents: number) => {
    setNet((prev) => ({ ...prev, You: prev.You - cents, [person]: prev[person] + cents }));
    announce(`${person} settled up with you.`);
  };

  return (
    <div className="mmoney">
      <p className="mmoney__back">
        <Icon name="chevronLeft" size={13} /> Overview
      </p>
      <div className="mmoney__title">
        <span>
          <span aria-hidden="true">🏡</span> Flatmates <Icon name="chevronDown" size={15} />
        </span>
        <span className="mround" aria-hidden="true">
          <Icon name="more" size={18} />
        </span>
      </div>
      <p className="mmicro">Your balance</p>
      <p className={`mmoney__balance${net.You < 0 ? " is-owing" : ""}`}>
        {net.You >= 0 ? "You're owed " : "You owe "}
        <Money cents={Math.abs(net.You)} />
      </p>

      <ul className="mgroup">
        {PEOPLE.map((p) => {
          const cents = mine[p];
          return (
            <li key={p} className="mgroup__row">
              <Avatar person={p} />
              <span className="mgroup__text">
                <strong>{p}</strong>
                <small className={cents > 0 ? "is-owed" : cents < 0 ? "is-owing" : undefined}>
                  {cents === 0 ? "settled up" : cents > 0 ? <>owes you <Money cents={cents} /></> : <>you owe <Money cents={-cents} /></>}
                </small>
              </span>
              {cents > 0 && (
                <button type="button" className="mpill mpill--small" onClick={() => settle(p, cents)}>
                  <Icon name="check" size={13} /> Settle
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <>
          <p className="mmicro">Between others</p>
          {others.map((t) => (
            <p key={`${t.from}-${t.to}`} className="mmoney__other">
              <span>
                {t.from} → {t.to} · <Money cents={t.cents} />
              </span>
              <span className="mmoney__other-action">Settle</span>
            </p>
          ))}
        </>
      )}

      <span className="mpill mmoney__record" aria-hidden="true">
        <Icon name="plus" size={14} /> Record payment
      </span>

      <p className="mmicro">Your spend</p>
      <p className="mmoney__spend">
        <Money cents={yourSpend} />
      </p>

      <button type="button" className="madd" onClick={() => setAdding(true)}>
        <span className="madd__plus">
          <Icon name="plus" size={16} />
        </span>
        Add a spend
        <span className="madd__mic" aria-hidden="true">
          <Icon name="mic" size={17} />
        </span>
      </button>

      {adding && <AddSpendSheet onAdd={add} onClose={() => setAdding(false)} />}
    </div>
  );
}
