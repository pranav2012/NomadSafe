import type { PointerEvent } from "react";
import { STORE_LINKS } from "../site";

// Magnetic hover: the badge drifts a few pixels toward a mouse pointer.
function onMagnet(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  el.style.setProperty("--tx", `${(((e.clientX - box.left) / box.width - 0.5) * 10).toFixed(1)}px`);
  el.style.setProperty("--ty", `${(((e.clientY - box.top) / box.height - 0.5) * 8).toFixed(1)}px`);
}

function offMagnet(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.removeProperty("--tx");
  e.currentTarget.style.removeProperty("--ty");
}

function PlayIcon() {
  return (
    <svg className="store-badge__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 3.5v17a.8.8 0 0 0 1.2.7l14.3-8.5a.8.8 0 0 0 0-1.4L6.2 2.8A.8.8 0 0 0 5 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M5.4 3 14 12l-8.6 9M14 12l3.2-3.2M14 12l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

function AppStoreIcon() {
  return (
    <svg className="store-badge__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.6 7.5 14.8 16.5M14.4 7.5l-5.2 9M7 13.6h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const STORES = [
  { key: "play", name: "Google Play", live: "Get it on", soon: "Coming soon", Icon: PlayIcon },
  { key: "appStore", name: "App Store", live: "Download on the", soon: "Coming soon", Icon: AppStoreIcon },
] as const;

export function StoreBadges({ center = false }: { center?: boolean }) {
  return (
    <ul className={center ? "badges badges--center" : "badges"} aria-label="Download NomadSafe">
      {STORES.map(({ key, name, live, soon, Icon }) => {
        const href = STORE_LINKS[key];
        const body = (
          <>
            <Icon />
            <span className="store-badge__text">
              <span className="store-badge__kicker">{href ? live : soon}</span>
              <span className="store-badge__store">{name}</span>
            </span>
          </>
        );
        return (
          <li key={key}>
            {href ? (
              <a className="store-badge" href={href} rel="noopener" onPointerMove={onMagnet} onPointerLeave={offMagnet}>
                {body}
              </a>
            ) : (
              <span className="store-badge store-badge--soon" onPointerMove={onMagnet} onPointerLeave={offMagnet}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
