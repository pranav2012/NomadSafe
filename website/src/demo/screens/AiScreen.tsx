import { Icon } from "../icons";

const SUGGESTIONS = ["How much have we spent in Lisbon?", "What's left in my budget per day?", "Somewhere quiet for dinner nearby?"];

/** AI tab, static: the guide's starting screen with suggestions. */
export function AiScreen() {
  return (
    <div className="mai">
      <div className="mai__head">
        <span className="mtitle">AI</span>
        <span className="mchip">
          About: Portugal <Icon name="chevronDown" size={13} />
        </span>
      </div>
      <div className="mai__hero">
        <span className="mai__orb" aria-hidden="true" />
        <p>Ask about your trip, your spending or what to do next. It runs on your phone, even offline.</p>
      </div>
      <div className="mai__suggest" aria-hidden="true">
        {SUGGESTIONS.map((q) => (
          <span key={q} className="mchip mchip--action">
            {q}
          </span>
        ))}
      </div>
      <div className="mai__composer" aria-hidden="true">
        <span>Ask about Portugal…</span>
        <Icon name="send" size={17} />
      </div>
    </div>
  );
}
