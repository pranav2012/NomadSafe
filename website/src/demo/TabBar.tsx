import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { TabId } from "./data/demo";
import { Icon, type IconName } from "./icons";

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "trip", label: "Trip", icon: "compass" },
  { id: "safety", label: "Safety", icon: "shield" },
  { id: "money", label: "Money", icon: "wallet" },
  { id: "ai", label: "AI", icon: "sparkle" },
];

const DRAG_SLOP_PX = 6;

/** The floating glass tab bar; tap a tab or drag the lens across, like the app. */
export function TabBar({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  const index = TABS.findIndex((t) => t.id === tab);
  const lensRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(index);
  const drag = useRef<{ id: number; startX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragPos, setDragPos] = useState<number | null>(null);

  useEffect(() => {
    const lens = lensRef.current;
    if (!lens || previous.current === index) return;
    const distance = Math.abs(index - previous.current);
    previous.current = index;
    if (dragPos !== null) return;
    lens.style.setProperty("--stretch", String(1 + Math.min(0.35, distance * 0.14)));
    lens.classList.remove("is-moving");
    void lens.offsetWidth;
    lens.classList.add("is-moving");
  }, [index, dragPos]);

  // Lens position (0–3, fractional) under the pointer, from the bar's on-screen box so the phone's CSS scale doesn't matter.
  const positionAt = (bar: HTMLElement, clientX: number) => {
    const box = bar.getBoundingClientRect();
    const inset = box.width * (5 / 362);
    const slot = (box.width - inset * 2) / TABS.length;
    return Math.min(TABS.length - 1, Math.max(0, (clientX - box.left - inset) / slot - 0.5));
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, startX: e.clientX, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_SLOP_PX) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragPos(positionAt(e.currentTarget, e.clientX));
  };
  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    suppressClick.current = true;
    const next = Math.round(positionAt(e.currentTarget, e.clientX));
    setDragPos(null);
    if (TABS[next].id !== tab) onChange(TABS[next].id);
  };

  const lit = dragPos === null ? index : Math.round(dragPos);

  return (
    <nav
      className={`mini-tabbar${dragPos !== null ? " is-dragging" : ""}`}
      aria-label="Demo app tabs"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <span
        ref={lensRef}
        className={`mini-tabbar__lens mini-tabbar__lens--${index}`}
        style={dragPos !== null ? { ["--i" as string]: dragPos } : undefined}
        aria-hidden="true"
      />
      {TABS.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className={`mini-tabbar__tab${i === lit ? " is-active" : ""}`}
          aria-current={t.id === tab ? "page" : undefined}
          onClick={() => onChange(t.id)}
        >
          <Icon name={t.icon} size={22} filled={i === lit} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
