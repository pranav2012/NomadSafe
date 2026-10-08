import { useId } from "react";

const N_PATH = "M184 340 V172 L328 340 V172";
const ARC_PATH = "M92 380 C170 430 342 430 420 380";

/** The aurora N. `animated` replays the app splash: the glow blooms, then the dotted arc draws in. */
export function LogoMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  const id = useId();
  const gradient = `${id}g`;
  const mask = `${id}m`;
  const blur = `${id}b`;
  return (
    <svg className={`${className ?? ""}${animated ? " logo--animated" : ""}`} viewBox="80 140 352 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="96" y1="420" x2="416" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22C7B8" />
          <stop offset="0.55" stopColor="#5B6CFF" />
          <stop offset="1" stopColor="#9B7BFF" />
        </linearGradient>
        <filter id={blur} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <mask id={mask} maskUnits="userSpaceOnUse" x="60" y="340" width="400" height="100">
          <path className="logo__arc-reveal" d={ARC_PATH} pathLength={1} fill="none" stroke="#fff" strokeWidth="24" strokeLinecap="round" />
        </mask>
      </defs>
      <path className="logo__glow" d={N_PATH} fill="none" stroke={`url(#${gradient})`} strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${blur})`} />
      <path className="logo__n" d={N_PATH} fill="none" stroke={`url(#${gradient})`} strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d={ARC_PATH}
        mask={`url(#${mask})`}
        fill="none"
        stroke="#EDEFF5"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="2 22"
        opacity="0.6"
      />
    </svg>
  );
}
