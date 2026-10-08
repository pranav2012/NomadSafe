import { LogoMark } from "./Logo";

const SECTIONS = [
  { id: "memories", label: "Memories" },
  { id: "planning", label: "Planning" },
  { id: "money", label: "Money" },
  { id: "safety", label: "Safety" },
];

export function Header({ showSections = true }: { showSections?: boolean }) {
  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        <a className="brand" href="/" aria-label="NomadSafe home">
          <LogoMark className="brand__mark" />
          <span className="brand__name">NomadSafe</span>
        </a>
        {showSections && (
          <nav className="site-nav" aria-label="Sections">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <a className="site-header__privacy" href="/privacy">
          Privacy
        </a>
      </div>
    </header>
  );
}
