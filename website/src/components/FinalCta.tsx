import { Aurora } from "./Aurora";
import { EARLY_ACCESS } from "../site";
import { GroupIcon, PlayIcon, StoreBadges } from "./StoreBadges";

/** Joining the Google Play closed test: the testers group first, then the Play page. */
function EarlyAccessJoin({ group, play }: { group: string; play: string }) {
  return (
    <>
      <ul className="badges badges--center" aria-label="Join early access">
        <li>
          <a className="store-badge" href={group} rel="noopener">
            <GroupIcon />
            <span className="store-badge__text">
              <span className="store-badge__kicker">Step 1</span>
              <span className="store-badge__store">Join the beta</span>
            </span>
          </a>
        </li>
        <li>
          <a className="store-badge store-badge--outline" href={play} rel="noopener">
            <PlayIcon />
            <span className="store-badge__text">
              <span className="store-badge__kicker">Step 2</span>
              <span className="store-badge__store">Install on Play</span>
            </span>
          </a>
        </li>
      </ul>
      <p className="cta__note">Join with your phone&rsquo;s Google account, then give Play a few hours before the install page opens.</p>
    </>
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
              <p className="lede">Early access is open on Google Play.</p>
              <EarlyAccessJoin group={EARLY_ACCESS.group} play={EARLY_ACCESS.play} />
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
