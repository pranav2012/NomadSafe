const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

interface TabIconPaths {
  stroke: string;
  dot: string | null;
  /** Filled silhouette for the selected state, like SF Symbols' `.fill` variants. */
  solid: string | null;
  /** Lines punched back out of the filled silhouette. */
  cutout: string | null;
}

/** Tab icons as SVG path data on a 24×24 grid, matching `components/nomad/Icon` so Skia can draw them. */
export const TAB_ICONS = {
  compass: {
    stroke: `${circle(12, 12, 9)}M15.5 8.5l-2 5-5 2 2-5 5-2z`,
    dot: null,
    solid: circle(12, 12, 9.4),
    cutout: "M15.5 8.5l-2 5-5 2 2-5 5-2z",
  },
  shield: {
    stroke: "M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3zM9 12l2 2 4-4",
    dot: null,
    solid: "M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z",
    cutout: "M9 12l2 2 4-4",
  },
  users: {
    stroke: `${circle(9, 8, 3)}M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6${circle(17, 7, 2.5)}M15 14c3.3 0 6 2 6 5`,
    dot: null,
    solid: `${circle(9, 8, 3.4)}M2.6 20.4c0-3.6 2.9-6.6 6.4-6.6s6.4 3 6.4 6.6z${circle(17, 7, 2.8)}M15.6 13.6c3.6 0 6 2.2 6 5.6h-4.6c0-2.4-0.5-4-1.4-5.6z`,
    cutout: null,
  },
  wallet: {
    stroke: "M3 7a2 2 0 012-2h13a1 1 0 011 1v3H5a2 2 0 00-2 2V7zM3 11a2 2 0 012-2h15v10a1 1 0 01-1 1H5a2 2 0 01-2-2V11z",
    dot: circle(16, 14, 1.3),
    solid: "M3 7a2 2 0 012-2h13a1 1 0 011 1v3H5a2 2 0 00-2 2V7zM3 11a2 2 0 012-2h15v10a1 1 0 01-1 1H5a2 2 0 01-2-2V11z",
    cutout: null,
  },
  sparkle: {
    stroke: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
    dot: null,
    solid: null,
    cutout: null,
  },
} satisfies Record<string, TabIconPaths>;

export type TabIconName = keyof typeof TAB_ICONS;
