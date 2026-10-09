import { Aurora } from "./Aurora";
import { EARLY_ACCESS } from "../site";
import { StoreBadges } from "./StoreBadges";

/** How to join the Google Play closed test. */
function EarlyAccessSteps({ group, play }: { group: string; play: string }) {
  return (
    <ol className="steps" aria-label="How to join early access">
      <li className="steps__item">
        <span className="steps__num" aria-hidden="true">1</span>
        <div>
          <h3>Join the testers group</h3>
          <p>Use the same Google account as the Play Store on your Android phone.</p>
          <a className="steps__link" href={group} rel="noopener">
            Join the group
          </a>
        </div>
      </li>
      <li className="steps__item">
        <span className="steps__num" aria-hidden="true">2</span>
        <div>
          <h3>Give it a little time</h3>
          <p>Google Play can take a while, sometimes a few hours, to let your account in.</p>
        </div>
      </li>
      <li className="steps__item">
        <span className="steps__num" aria-hidden="true">3</span>
        <div>
          <h3>Install from Google Play</h3>
          <p>Open the NomadSafe page on your phone and tap Install.</p>
          <a className="steps__link" href={play} rel="noopener">
            Open Google Play
          </a>
        </div>
      </li>
    </ol>
  );
}

export function FinalCta() {
  return (
    <section className="cta" id="early-access" aria-labelledby="cta-title">
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
          {EARLY_ACCESS ? (
            <>
              <p className="lede">NomadSafe is in early access on Google Play. Join in three steps; the App Store comes after.</p>
              <EarlyAccessSteps group={EARLY_ACCESS.group} play={EARLY_ACCESS.play} />
            </>
          ) : (
            <>
              <p className="lede">NomadSafe is coming to Google Play first, with the App Store after.</p>
              <StoreBadges center />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
