import { AiBand } from "./components/AiBand";
import { Features } from "./components/Features";
import { FinalCta } from "./components/FinalCta";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { PrivacyBand } from "./components/PrivacyBand";

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Features />
        <AiBand />
        <PrivacyBand />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
