import { CONTACT_EMAIL } from "../site";
import { LogoMark } from "./Logo";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <div className="site-footer__brand">
          <LogoMark className="brand__mark" />
          <span>© 2026 NomadSafe</span>
        </div>
        <nav aria-label="Legal and contact">
          <ul className="site-footer__links">
            <li>
              <a href="/privacy">Privacy policy</a>
            </li>
            <li>
              <a href="/delete-account">Delete account</a>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
            </li>
          </ul>
        </nav>
        <p className="site-footer__legal">
          Google Play is a trademark of Google LLC. App Store is a trademark of Apple Inc.
        </p>
        <p className="site-footer__legal">
          Amsterdam photo in the replay screenshot:{" "}
          <a href="https://commons.wikimedia.org/wiki/User:Basile_Morin">Basile Morin</a>,{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, via Wikimedia Commons.
        </p>
      </div>
    </footer>
  );
}
