import type { ReactNode } from "react";

import type { Journey } from "../features/journeys/domain";
import { useOnlineStatus } from "../hooks/use-online-status";
import { useI18n } from "../i18n/i18n";
import type { AppRoute } from "../routes";
import { routes } from "../routes";
import { AppLink } from "./app-link";

export function AppShell({
  route,
  journey,
  children,
}: {
  readonly route: AppRoute;
  readonly journey?: Journey;
  readonly children: ReactNode;
}) {
  const { locale, setLocale, t } = useI18n();
  const online = useOnlineStatus();
  const path = window.location.pathname;
  const journeyNavigation = journey
    ? [
        { to: routes.journey(journey.id), label: t("nav.overview") },
        { to: routes.timeline(journey.id), label: t("nav.timeline") },
        { to: routes.packing(journey.id), label: t("nav.packing") },
      ]
    : [];
  const mobileNavigation = journey
    ? journeyNavigation
    : [
        { to: routes.journeys, label: t("nav.journeys") },
        { to: routes.settings, label: t("nav.settings") },
        { to: routes.about, label: t("nav.about") },
      ];
  const current = (to: string) => path === to;

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        {t("app.skip")}
      </a>
      <aside className="sidebar">
        <AppLink
          className="brand"
          to={routes.journeys}
          ariaLabel={t("app.home")}
        >
          <span className="brand-mark" aria-hidden="true">
            X
          </span>
          <span>TRAX OS</span>
        </AppLink>
        <nav className="sidebar-nav" aria-label={t("app.home")}>
          <AppLink
            to={routes.journeys}
            className={route.name === "journeys" ? "active" : undefined}
            ariaCurrent={route.name === "journeys" ? "page" : undefined}
          >
            <span aria-hidden="true">⌂</span>
            {t("nav.journeys")}
          </AppLink>
          {journeyNavigation.map((item) => (
            <AppLink
              key={item.to}
              to={item.to}
              className={current(item.to) ? "active" : undefined}
              ariaCurrent={current(item.to) ? "page" : undefined}
            >
              <span aria-hidden="true">•</span>
              {item.label}
            </AppLink>
          ))}
          <AppLink
            to={routes.settings}
            className={current(routes.settings) ? "active" : undefined}
            ariaCurrent={current(routes.settings) ? "page" : undefined}
          >
            <span aria-hidden="true">⚙</span>
            {t("nav.settings")}
          </AppLink>
          <AppLink
            to={routes.about}
            className={current(routes.about) ? "active" : undefined}
            ariaCurrent={current(routes.about) ? "page" : undefined}
          >
            <span aria-hidden="true">ⓘ</span>
            {t("nav.about")}
          </AppLink>
        </nav>
        <div className="sidebar-footer">
          <label htmlFor="locale-select">{t("locale.label")}</label>
          <select
            id="locale-select"
            value={locale}
            onChange={(event) =>
              setLocale(event.target.value === "nl" ? "nl" : "en")
            }
          >
            <option value="en">{t("locale.en")}</option>
            <option value="nl">{t("locale.nl")}</option>
          </select>
          <p className="network-state" data-online={online}>
            <span aria-hidden="true">{online ? "●" : "○"}</span>
            {online ? t("status.online") : t("status.offline")}
          </p>
        </div>
      </aside>
      <header className="mobile-header">
        <AppLink
          className="brand"
          to={routes.journeys}
          ariaLabel={t("app.home")}
        >
          <span className="brand-mark" aria-hidden="true">
            X
          </span>
          <span>TRAX OS</span>
        </AppLink>
        <span className="local-chip">{t("common.localOnly")}</span>
      </header>
      <main id="main-content" className="app-content">
        {children}
      </main>
      <nav className="mobile-nav" aria-label={journey?.name ?? t("app.home")}>
        {mobileNavigation.map((item) => (
          <AppLink
            key={item.to}
            to={item.to}
            className={current(item.to) ? "active" : undefined}
            ariaCurrent={current(item.to) ? "page" : undefined}
          >
            {item.label}
          </AppLink>
        ))}
      </nav>
    </div>
  );
}
