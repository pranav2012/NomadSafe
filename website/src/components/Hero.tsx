import { useEffect, useRef } from "react";
import { Aurora } from "./Aurora";
import { DemoPhone } from "./DemoPhone";
import { StoreBadges } from "./StoreBadges";

export function Hero() {
  const ref = useRef<HTMLElement>(null);

  // The aurora leans a little toward the pointer (fine pointers only, eased in CSS).
  useEffect(() => {
    const hero = ref.current;
    if (!hero || !window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      x = e.clientX / window.innerWidth - 0.5;
      y = e.clientY / window.innerHeight - 0.5;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        hero.style.setProperty("--mx", x.toFixed(3));
        hero.style.setProperty("--my", y.toFixed(3));
      });
    };
    hero.addEventListener("pointermove", onMove);
    return () => {
      hero.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={ref} className="hero" aria-labelledby="hero-title">
      <Aurora />
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
          <div className="hero__glow" aria-hidden="true" />
          <DemoPhone size="hero" label="Interactive demo of the NomadSafe app" tab="trip" globe hint="Tap around · it's a live demo" />
        </div>
      </div>
    </section>
  );
}
