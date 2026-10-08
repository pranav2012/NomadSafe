import type { ReactNode } from "react";

export interface Point {
  title: string;
  body: string;
}

interface FeatureProps {
  id: string;
  index: string;
  label: string;
  title: string;
  points: Point[];
  footnote?: string;
  media: ReactNode;
  glow: "teal" | "indigo" | "violet" | "rose";
  flip?: boolean;
}

export function Feature({ id, index, label, title, points, footnote, media, glow, flip = false }: FeatureProps) {
  return (
    <section id={id} className={flip ? "feature feature--flip" : "feature"} aria-labelledby={`${id}-title`}>
      <div className="wrap feature__grid">
        <div className="feature__copy reveal">
          <p className="eyebrow">
            <span className="eyebrow__index">{index}</span>
            {label}
          </p>
          <h2 id={`${id}-title`}>{title}</h2>
          <ul className="points">
            {points.map((p) => (
              <li key={p.title}>
                <strong>{p.title}</strong> {p.body}
              </li>
            ))}
          </ul>
          {footnote && <p className="footnote">{footnote}</p>}
        </div>
        <div className="feature__media reveal">
          <div className={`halo halo--${glow}`} aria-hidden="true" />
          {media}
        </div>
      </div>
    </section>
  );
}
