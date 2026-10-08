import { Aurora } from "./components/Aurora";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";

export function NotFound() {
  return (
    <>
      <Header showSections={false} />
      <main id="main" className="not-found">
        <Aurora />
        <div className="wrap not-found__inner">
          <p className="not-found__code gradient-text">404</p>
          <h1>This page wandered off the map.</h1>
          <p className="lede">The link may be old or mistyped. Let's get you back on the route.</p>
          <a className="button" href="/">
            Back to NomadSafe
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
