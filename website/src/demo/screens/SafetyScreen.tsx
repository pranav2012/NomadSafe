import { useCallback, useEffect, useRef } from "react";
import { Icon } from "../icons";
import { useSosHold } from "../useSosHold";

const RING = 2 * Math.PI * 46;

// A few hand-drawn streets and the river for the map; the app uses a dark Google map here.
const STREETS = [
  "M-20 140 C 80 120 160 170 260 150 S 380 120 430 140",
  "M-20 260 C 60 240 150 290 240 250 S 360 220 430 260",
  "M40 -10 C 60 80 30 160 70 240 S 90 360 60 470",
  "M180 -10 C 170 90 210 170 190 260 S 160 380 200 470",
  "M310 -10 C 300 70 340 160 320 250 S 290 380 330 470",
  "M-20 380 C 90 360 170 400 260 370 S 370 350 430 380",
  "M100 60 L 260 330",
  "M260 40 L 120 420",
];
const RIVER = "M-20 455 C 90 430 200 470 300 440 S 400 420 430 430 L 430 520 L -20 520 Z";

/** Safety tab: map of your circle, Hold for SOS, the three tiles and the circle row. */
export function SafetyScreen({ announce }: { announce: (text: string) => void }) {
  const ringRef = useRef<SVGCircleElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const setRing = useCallback((f: number) => ringRef.current?.style.setProperty("stroke-dashoffset", String(RING * (1 - f))), []);
  const { phase, cancel, reset, buttonProps } = useSosHold(setRing, announce);
  const takeover = phase.kind === "countdown" || phase.kind === "done";

  useEffect(() => {
    if (phase.kind === "countdown" && phase.seconds === 5) cancelRef.current?.focus();
  }, [phase]);

  return (
    <div className="msafety">
      <svg className="msafety__map" viewBox="0 0 402 470" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d={RIVER} className="msafety__river" />
        {STREETS.map((d) => (
          <path key={d} d={d} className="msafety__street" />
        ))}
        <g className="msafety__me" transform="translate(110 140)">
          <circle r="22" className="msafety__me-halo" />
          <circle r="9" className="msafety__me-dot" />
        </g>
        <g className="msafety__friend" transform="translate(250 230)">
          <circle r="15" />
          <text y="4.5" textAnchor="middle">M</text>
        </g>
        <g className="msafety__friend" transform="translate(70 360)">
          <circle r="15" />
          <text y="4.5" textAnchor="middle">L</text>
        </g>
      </svg>

      <div className="msafety__top">
        <span className="mtitle">Safety</span>
        <span className="mchip mchip--status">
          <i /> All clear
        </span>
      </div>
      <span className="mround msafety__locate" aria-hidden="true">
        <Icon name="pin" size={18} />
      </span>

      <div className="msafety__sos">
        <span className="msafety__hint">Hold for SOS</span>
        <button type="button" className={`msos msos--${phase.kind}`} aria-label="SOS demo: press and hold for 2 seconds. Nothing is sent." {...buttonProps}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="msos__track" cx="50" cy="50" r="46" />
            <circle ref={ringRef} className="msos__ring" cx="50" cy="50" r="46" strokeDasharray={RING.toFixed(2)} strokeDashoffset={RING.toFixed(2)} />
          </svg>
          SOS
        </button>
      </div>
      <p className="mdemo-tag">Demo — nothing is sent</p>

      <div className="msafety__panel">
        <div className="mtiles">
          <span className="mtile">
            <Icon name="pin" size={19} />
            <strong>Share location</strong>
            <small>Off</small>
          </span>
          <span className="mtile">
            <Icon name="clock" size={19} />
            <strong>Safe-arrival timer</strong>
            <small>Set a timer</small>
          </span>
          <span className="mtile mtile--call">
            <Icon name="phone" size={19} />
            <strong>Call 112</strong>
            <small>Portugal</small>
          </span>
        </div>
        <div className="mcircle">
          <span className="mcircle__faces" aria-hidden="true">
            <span>L</span>
            <span>M</span>
            <span>M</span>
          </span>
          <span className="mcircle__text">
            <strong>Your circle</strong>
            <small>3 people get your alerts</small>
          </span>
          <Icon name="chevronRight" size={16} />
        </div>
      </div>

      {takeover && (
        <div className="mtakeover" role="alertdialog" aria-label="SOS demo countdown">
          <span className="mdemo-tag mdemo-tag--light">Demo — nothing is sent</span>
          {phase.kind === "countdown" ? (
            <>
              <p className="mtakeover__title">Sending SOS in</p>
              <p className="mtakeover__count" key={phase.seconds}>
                {phase.seconds}
              </p>
              <p className="mtakeover__body">Your circle will get a push notification and can see where you are.</p>
              <button ref={cancelRef} type="button" className="mbutton mbutton--light" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <p className="mtakeover__title">Demo finished</p>
              <p className="mtakeover__body">
                In the app, Leo, Maya and Mo would get a push notification now. This demo sent nothing.
              </p>
              <button type="button" className="mbutton mbutton--light" onClick={reset}>
                Back to Safety
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
