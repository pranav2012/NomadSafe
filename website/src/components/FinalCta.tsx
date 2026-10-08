import { Aurora } from "./Aurora";
import { StoreBadges } from "./StoreBadges";

export function FinalCta() {
  return (
    <section className="cta" aria-labelledby="cta-title">
      <div className="wrap">
        <div className="cta__card reveal">
          <Aurora soft />
          <svg className="cta__arc" viewBox="0 0 600 120" aria-hidden="true" focusable="false">
            <path
              d="M20 100 C 160 10, 440 10, 580 100"
              fill="none"
              stroke="#EDEFF5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="1 12"
              opacity="0.5"
            />
          </svg>
          <h2 id="cta-title">Your next trip, all in one place.</h2>
          <p className="lede">NomadSafe is coming to Google Play first, with the App Store after.</p>
          <StoreBadges center />
        </div>
      </div>
    </section>
  );
}
