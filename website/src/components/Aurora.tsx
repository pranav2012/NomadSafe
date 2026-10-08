export function Aurora({ soft = false }: { soft?: boolean }) {
  return (
    <div className={soft ? "aurora aurora--soft" : "aurora"} aria-hidden="true">
      <span className="aurora__stars" />
      <span className="aurora__blob aurora__blob--teal" />
      <span className="aurora__blob aurora__blob--indigo" />
      <span className="aurora__blob aurora__blob--violet" />
      <span className="aurora__band" />
    </div>
  );
}
