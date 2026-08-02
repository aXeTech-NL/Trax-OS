import { AuthProvider, useAuth } from "./auth/auth";
import { AppShell } from "./components/app-shell";
import {
  JourneyDataProvider,
  useJourneyData,
} from "./features/journeys/journey-data";
import {
  JourneyEditorPage,
  JourneyLibraryPage,
  JourneyOverviewPage,
} from "./features/journeys/journey-pages";
import { PackingPage } from "./features/journeys/packing-page";
import { TimelinePage } from "./features/journeys/timeline-page";
import { I18nProvider, useI18n } from "./i18n/i18n";
import {
  AboutPage,
  DataSettingsPage,
  NotFoundPage,
} from "./pages/static-pages";
import type { AuthRepository } from "./repositories/auth-repository";
import type { InstanceRepository } from "./repositories/instance-repository";
import type { JourneyRepository } from "./repositories/journey-repository";
import { parseRoute } from "./routes";
import { usePathname } from "./use-pathname";

interface AppProps {
  readonly repository: InstanceRepository;
  readonly journeyRepository: JourneyRepository;
  readonly authRepository: AuthRepository;
}

export function App({
  repository,
  journeyRepository,
  authRepository,
}: AppProps) {
  return (
    <I18nProvider repository={journeyRepository}>
      <AuthProvider repository={authRepository}>
        <AuthenticatedApplication
          repository={repository}
          journeyRepository={journeyRepository}
        />
      </AuthProvider>
    </I18nProvider>
  );
}

function AuthenticatedApplication({
  repository,
  journeyRepository,
}: {
  readonly repository: InstanceRepository;
  readonly journeyRepository: JourneyRepository;
}) {
  const auth = useAuth();
  return (
    <JourneyDataProvider
      repository={journeyRepository}
      onAuthenticationRequired={auth.anonymous}
    >
      <Application repository={repository} />
    </JourneyDataProvider>
  );
}

function Application({
  repository,
}: {
  readonly repository: InstanceRepository;
}) {
  const pathname = usePathname();
  const route = parseRoute(pathname);
  const { data, status, storageError, retry } = useJourneyData();
  const { t } = useI18n();
  const auth = useAuth();
  const journeyId = "journeyId" in route ? route.journeyId : undefined;
  const journey = journeyId
    ? data.journeys.find((candidate) => candidate.id === journeyId)
    : undefined;

  let page;
  if (status === "loading") {
    page = (
      <section className="empty-state" aria-live="polite" aria-busy="true">
        <div className="status-dot status-dot--loading" aria-hidden="true" />
        <h1>{t("common.loading")}</h1>
      </section>
    );
  } else if (status === "error") {
    page = (
      <section className="empty-state" role="alert">
        <h1>{t("status.storageError")}</h1>
        <button type="button" onClick={retry}>
          {t("common.retry")}
        </button>
      </section>
    );
  } else if (journeyId && !journey) {
    page = <NotFoundPage />;
  } else {
    switch (route.name) {
      case "journeys":
        page = <JourneyLibraryPage />;
        break;
      case "journey-new":
        page = <JourneyEditorPage />;
        break;
      case "journey":
        page = journey ? (
          <JourneyOverviewPage journey={journey} />
        ) : (
          <NotFoundPage />
        );
        break;
      case "timeline":
        page = journey ? <TimelinePage journey={journey} /> : <NotFoundPage />;
        break;
      case "packing":
        page = journey ? <PackingPage journey={journey} /> : <NotFoundPage />;
        break;
      case "settings":
        page = <DataSettingsPage />;
        break;
      case "about":
        page = <AboutPage repository={repository} />;
        break;
      default:
        page = <NotFoundPage />;
    }
  }

  return (
    <AppShell
      route={route}
      journey={journey}
      user={auth.state.status === "authenticated" ? auth.state.user : undefined}
      onLogout={() => void auth.logout()}
    >
      {storageError && (
        <div className="global-alert" role="alert">
          {t("status.storageError")}
        </div>
      )}
      {page}
    </AppShell>
  );
}
