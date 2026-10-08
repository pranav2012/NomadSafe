import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../hooks/motion";
import { CITIES, LEGS, arcPath, project, toVector, viewMatrix, type Frame } from "../components/globe/geo";

// The Trip tab's globe area, in app points: the disc's top edge is the horizon just under the header.
const FRAME: Frame = { width: 402, height: 420, cx: 201, cy: 690, r: 620 };
const VIEW = { lat: 1, lng: 2.5 };
const BASE = viewMatrix(VIEW.lat, VIEW.lng);

const LABELS: Record<string, { dx: number; dy: number }> = {
  paris: { dx: 0, dy: 16 },
  amsterdam: { dx: -34, dy: -24 },
  berlin: { dx: 0, dy: -30 },
  prague: { dx: 22, dy: 14 },
  lisbon: { dx: 0, dy: 18 },
  porto: { dx: -40, dy: -14 },
};

function byId(id: string) {
  return CITIES.find((c) => c.id === id)!;
}

/** Live WebGL globe for the demo's Trip tab, with a prerendered still and route overlay underneath. */
export function PhoneGlobe({ enabled }: { enabled: boolean }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!enabled || started.current || !surface || !canvas || !overlay || prefersReducedMotion()) return;

    let dispose: (() => void) | null = null;
    let cancelled = false;
    // ?globe=still draws one frame at the resting view; used to capture public/img/phone-globe.webp.
    const still = new URLSearchParams(window.location.search).get("globe") === "still";

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      observer.disconnect();
      const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
      idle(async () => {
        try {
          const { startGlobe } = await import("../components/globe/renderer");
          if (cancelled) return;
          dispose = await startGlobe({
            canvas,
            overlay,
            surface,
            still,
            frame: FRAME,
            view: VIEW,
            sway: 6,
            onFirstFrame: () => surface.classList.add("is-live"),
          });
          if (cancelled) dispose?.();
        } catch {
          /* the still image stays */
        }
      });
    });
    observer.observe(surface);
    return () => {
      cancelled = true;
      observer.disconnect();
      dispose?.();
      started.current = false;
    };
  }, [enabled]);

  return (
    <div ref={surfaceRef} className="pglobe" role="img" aria-label="Globe with the demo trip: Paris, Amsterdam, Berlin and Prague, and today's leg from Lisbon to Porto.">
      <img className="pglobe__still" src="/img/phone-globe.webp" width={804} height={840} alt="" draggable={false} decoding="async" />
      <canvas ref={canvasRef} className="pglobe__canvas" aria-hidden="true" onDragStart={(e) => e.preventDefault()} />
      <svg ref={overlayRef} className="pglobe__overlay" viewBox={`0 0 ${FRAME.width} ${FRAME.height}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="pglobe-today" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#22C7B8" />
            <stop offset="1" stopColor="#9B7BFF" />
          </linearGradient>
        </defs>
        {LEGS.map((leg) => {
          const d = arcPath(BASE, byId(leg.from), byId(leg.to), FRAME);
          const key = `${leg.from}-${leg.to}`;
          return (
            <g key={key} className={leg.today ? "arc arc--today" : "arc"}>
              <path className="arc__glow" data-leg={key} d={d} />
              <path className="arc__line" data-leg={key} d={d} />
            </g>
          );
        })}
        {CITIES.map((city) => {
          const p = project(BASE, toVector(city.lat, city.lng), FRAME);
          const label = LABELS[city.id];
          const text = city.kind === "today" ? "Lisbon · 17°" : city.name;
          const w = text.length * 6.4 + 16;
          return (
            <g key={city.id} data-city={city.id} className={`pin pin--${city.kind}`} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
              {city.kind === "today" && <circle className="pin__pulse" r="7" />}
              <circle className="pin__rim" r={city.kind === "today" ? 7.5 : 4.5} />
              <circle className="pin__dot" r={city.kind === "today" ? 6.5 : 3.5} />
              {city.kind !== "visited" && <circle className="pin__core" r={city.kind === "today" ? 4 : 2} />}
              <g transform={`translate(${label.dx} ${label.dy})`}>
                <rect className="pin__pill" x={-w / 2} y={-10} width={w} height={20} rx={10} />
                <text className="pin__label" y={4} textAnchor="middle">
                  {text}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
