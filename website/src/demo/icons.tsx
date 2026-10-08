import { useId } from "react";

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

// Same 24×24 paths as the app's tab bar (src/atoms/tabbar/tabIcons.ts) plus a few UI glyphs.
const PATHS = {
  compass: `${circle(12, 12, 9)}M15.5 8.5l-2 5-5 2 2-5 5-2z`,
  shield: "M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3zM9 12l2 2 4-4",
  wallet: "M3 7a2 2 0 012-2h13a1 1 0 011 1v3H5a2 2 0 00-2 2V7zM3 11a2 2 0 012-2h15v10a1 1 0 01-1 1H5a2 2 0 01-2-2V11z",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM12 12.2a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z",
  clock: `${circle(12, 12, 9)}M12 7v5l3 2`,
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  mic: "M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",
  swap: "M7 7h11l-3-3M17 17H6l3 3",
  users: `${circle(9, 8, 3)}M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6${circle(17, 7, 2.5)}M15 14c3.3 0 6 2 6 5`,
  more: `${circle(6, 12, 1.2)}${circle(12, 12, 1.2)}${circle(18, 12, 1.2)}`,
  fork: "M7 3v8a2 2 0 002 2v8M7 3v5M11 3v5a2 2 0 01-2 2M16 3c-1.7 1.4-2 3.6-2 6v4h3V3zM17 13v8",
  sun: `${circle(12, 12, 4)}M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4`,
  play: "M8 5.5v13l10-6.5-10-6.5z",
  tram: "M6 5h12v10a2 2 0 01-2 2H8a2 2 0 01-2-2V5zM6 10h12M9 20l1.5-3M15 20l-1.5-3M12 2v3",
  bed: "M3 18v-7a2 2 0 012-2h14a2 2 0 012 2v7M3 14h18M7 9V7",
  send: "M4 12l16-8-6 16-2.5-6.5L4 12z",
} as const;

// Selected-state silhouettes with lines punched out, like the app's `solid` + `cutout` tab icons.
const SOLID: Partial<Record<keyof typeof PATHS, { solid: string; cutout: string }>> = {
  compass: { solid: circle(12, 12, 9.4), cutout: "M15.5 8.5l-2 5-5 2 2-5 5-2z" },
  shield: { solid: "M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z", cutout: "M9 12l2 2 4-4" },
};

export type IconName = keyof typeof PATHS;

const FILLABLE = new Set<IconName>(["wallet", "play", "send"]);

export function Icon({ name, size = 20, className, filled = false }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  const id = useId();
  const solid = filled ? SOLID[name] : undefined;
  const fill = filled && FILLABLE.has(name);
  if (solid) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <mask id={id}>
          <rect width="24" height="24" fill="#fff" />
          <path d={solid.cutout} fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
        <path d={solid.solid} fill="currentColor" mask={`url(#${id})`} />
      </svg>
    );
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill={fill ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={fill ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
