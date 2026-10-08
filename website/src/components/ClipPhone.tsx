import { useEffect, useRef } from "react";
import { useInView, useReducedMotion } from "../hooks/motion";

/** A recorded app clip in a phone frame; plays only while on screen, poster only under reduced motion. */
export function ClipPhone({ clip, label, hint }: { clip: string; label: string; hint: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const inView = useInView(ref, { threshold: 0.4 });
  const reduced = useReducedMotion();
  const play = inView && !reduced;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (play) {
      video.preload = "auto";
      void video.play().catch(() => {});
    } else video.pause();
  }, [play]);

  return (
    <div className="demo-phone demo-phone--section">
      <div className="phone phone--demo">
        <div className="phone__screen">
          <video
            ref={ref}
            className="phone__clip"
            poster={`/clips/${clip}.jpg`}
            width={720}
            height={1560}
            muted
            loop
            playsInline
            preload="none"
            draggable={false}
            aria-label={label}
          >
            <source src={`/clips/${clip}.webm`} type="video/webm" />
            <source src={`/clips/${clip}.mp4`} type="video/mp4" />
          </video>
        </div>
      </div>
      <p className="demo-phone__hint">
        <span className="demo-phone__dot" aria-hidden="true" />
        {hint}
      </p>
    </div>
  );
}
