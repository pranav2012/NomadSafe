export interface Placement {
  x: number;
  y: number;
  rotate: number;
}

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hand-stamped look: each item nudged and turned in its grid cell (seeded by id), kept inside the area. */
export function scatter(ids: string[], cols: number, rows: number, area: { width: number; height: number }, item: { width: number; height: number }, maxTilt = 12): Placement[] {
  const cellW = area.width / cols;
  const cellH = area.height / rows;
  return ids.map((id, i) => {
    const rand = seeded(id);
    const col = i % cols;
    const row = Math.floor(i / cols) % rows;
    const rotate = (rand() * 2 - 1) * maxTilt;
    const rad = (Math.abs(rotate) * Math.PI) / 180;
    const halfW = (item.width * Math.cos(rad) + item.height * Math.sin(rad)) / 2;
    const halfH = (item.width * Math.sin(rad) + item.height * Math.cos(rad)) / 2;
    const cx = (col + 0.5) * cellW + (rand() * 2 - 1) * cellW * 0.12;
    const cy = (row + 0.5) * cellH + (rand() * 2 - 1) * cellH * 0.14;
    const x = Math.max(halfW, Math.min(area.width - halfW, cx));
    const y = Math.max(halfH, Math.min(area.height - halfH, cy));
    return { x: x - item.width / 2, y: y - item.height / 2, rotate };
  });
}
