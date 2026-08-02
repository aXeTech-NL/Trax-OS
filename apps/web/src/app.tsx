import { AppLink } from "./components/app-link";
import { InstanceStatus } from "./components/instance-status";
import type { InstanceRepository } from "./repositories/instance-repository";
import { usePathname } from "./use-pathname";

interface AppProps {
  readonly repository: InstanceRepository;
}

export function App({ repository }: AppProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <AppLink className="brand" to="/" ariaLabel="Trax OS home">
          <span className="brand-mark" aria-hidden="true">
            X
          </span>
          <span>TRAX OS</span>
        </AppLink>
        <nav aria-label="Primary navigation">
          <AppLink
            className={pathname === "/" ? "active" : undefined}
            to="/"
            ariaCurrent={pathname === "/" ? "page" : undefined}
          >
            Foundation
          </AppLink>
          <AppLink
            className={pathname === "/about" ? "active" : undefined}
            to="/about"
            ariaCurrent={pathname === "/about" ? "page" : undefined}
          >
            About
          </AppLink>
        </nav>
      </header>
      <main id="main-content">
        {pathname === "/" ? (
          <FoundationPage repository={repository} />
        ) : pathname === "/about" ? (
          <AboutPage />
        ) : (
          <NotFoundPage />
        )}
      </main>
    </div>
  );
}

function FoundationPage({ repository }: AppProps) {
  return (
    <div className="page-grid">
      <section className="hero" aria-labelledby="foundation-title">
        <p className="eyebrow">Public foundation · v0.1</p>
        <h1 id="foundation-title">
          Your Travel OS starts with an open contract.
        </h1>
        <p className="hero-copy">
          This executable foundation connects a URL-routed web client to the
          typed public Trax OS API. Journey features remain intentionally
          deferred until their boundaries are decided.
        </p>
      </section>
      <InstanceStatus repository={repository} />
    </div>
  );
}

function AboutPage() {
  return (
    <article className="content-page">
      <p className="eyebrow">About this build</p>
      <h1>Small, public and reproducible</h1>
      <p>
        Trax OS v0.1 establishes health, version and capability discovery
        without inventing domain, identity or persistence behaviour.
      </p>
    </article>
  );
}

function NotFoundPage() {
  return (
    <article className="content-page">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <AppLink to="/">Return to the foundation</AppLink>
    </article>
  );
}
