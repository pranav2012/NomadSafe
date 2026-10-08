import { MiniApp, type MiniAppProps } from "../demo/MiniApp";

/** A phone frame running the interactive mini app. */
export function DemoPhone({ size = "section", hint = "Live demo · tap around", ...app }: MiniAppProps & { size?: "hero" | "section"; hint?: string }) {
  return (
    <div className={`demo-phone demo-phone--${size}`}>
      <div className="phone phone--demo">
        <div className="phone__screen">
          <MiniApp {...app} />
        </div>
      </div>
      <p className="demo-phone__hint">
        <span className="demo-phone__dot" aria-hidden="true" />
        {hint}
      </p>
    </div>
  );
}
