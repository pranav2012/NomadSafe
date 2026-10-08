import { Aurora } from "./Aurora";
import { Phone } from "./Phone";
import { StoreBadges } from "./StoreBadges";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <Aurora />
      <svg className="hero__arc" viewBox="0 0 1440 640" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path
          id="hero-arc-path"
          d="M-40 628 C 520 640, 860 420, 1480 70"
          fill="none"
          stroke="#EDEFF5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="1 12"
          vectorEffect="non-scaling-stroke"
        />
        <circle className="hero__arc-dot" r="4" fill="#9B7BFF">
          <animateMotion dur="16s" repeatCount="indefinite">
            <mpath href="#hero-arc-path" />
          </animateMotion>
        </circle>
      </svg>

      <div className="wrap hero__grid">
        <div className="hero__copy">
          <p className="pill">
            <span className="pill__dot" aria-hidden="true" />
            Launching soon on Android, then iPhone
          </p>
          <h1 id="hero-title">
            Every part of the trip, <span className="gradient-text">in one calm app.</span>
          </h1>
          <p className="lede">
            NomadSafe is your travel companion for memories, planning, money and safety, from the first saved idea to
            the replay at the end.
          </p>
          <StoreBadges />
          <ul className="trust" aria-label="Highlights">
            <li>Free to start</li>
            <li>AI guide on your phone</li>
            <li>Encrypted on your device</li>
          </ul>
        </div>

        <div className="hero__media">
          <div className="halo" aria-hidden="true" />
          <Phone
            className="phone--hero"
            src="/screens/home.png"
            alt="The NomadSafe home screen with a globe showing the trip route and today's plan."
            eager
          />
        </div>
      </div>
    </section>
  );
}
