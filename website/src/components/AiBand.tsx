export function AiBand() {
  return (
    <section className="band" aria-labelledby="ai-title">
      <div className="wrap">
        <div className="glass ai-band reveal">
          <div className="orb" aria-hidden="true">
            <span className="orb__core" />
          </div>
          <div className="ai-band__copy">
            <p className="eyebrow">AI travel guide</p>
            <h2 id="ai-title">A guide that lives on your phone.</h2>
            <p>
              Ask what to do next, how the budget is holding up, or who owes whom. After a one-time download, the guide
              runs entirely on your phone, so it works offline and your questions stay with you.
            </p>
            <ul className="chips" aria-label="AI options">
              <li>Works offline</li>
              <li>Runs on your phone</li>
              <li>Optional online AI</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
