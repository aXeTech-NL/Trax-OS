import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { InMemoryAuthRepository } from "./adapters/in-memory-auth-repository";
import { InMemoryJourneyRepository } from "./adapters/in-memory-journey-repository";
import { App } from "./app";
import type { JourneyData } from "./features/journeys/domain";
import type { InstanceRepository } from "./repositories/instance-repository";

const instance = {
  application: "Trax OS",
  version: "0.1.0",
  apiVersion: "1",
  capabilities: [
    { key: "foundation.contract-discovery", status: "available" as const },
  ],
};

function renderApp(
  route = "/",
  data?: JourneyData,
  getInstance = vi
    .fn<InstanceRepository["getInstance"]>()
    .mockResolvedValue(instance),
) {
  window.history.replaceState(null, "", route);
  const journeyRepository = new InMemoryJourneyRepository(data, "en");
  return {
    getInstance,
    journeyRepository,
    ...render(
      <App
        repository={{ getInstance }}
        journeyRepository={journeyRepository}
        authRepository={new InMemoryAuthRepository()}
      />,
    ),
  };
}

test("requires authentication before loading Journeys and supports register/logout", async () => {
  const user = userEvent.setup();
  const authRepository = new InMemoryAuthRepository(null);
  const journeyRepository = new InMemoryJourneyRepository(undefined, "en");
  const load = vi.spyOn(journeyRepository, "load");
  window.history.replaceState(null, "", "/");
  render(
    <App
      repository={{ getInstance: vi.fn().mockResolvedValue(instance) }}
      journeyRepository={journeyRepository}
      authRepository={authRepository}
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "Sign in to Trax OS" }),
  ).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Create an account/ }));
  await user.type(screen.getByLabelText("Display name"), "Maurice");
  await user.type(
    screen.getByLabelText("Email address"),
    "maurice@example.com",
  );
  await user.type(
    screen.getByLabelText("Password"),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    await screen.findByRole("heading", { name: "Plan your first journey" }),
  ).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in to Trax OS" }),
  ).toBeInTheDocument();
});

test("starts with authenticated server Journey onboarding without calling instance discovery", async () => {
  const { getInstance } = renderApp();

  expect(
    await screen.findByRole("heading", { name: "Plan your first journey" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Server-backed")).toBeInTheDocument();
  expect(getInstance).not.toHaveBeenCalled();
});

test("creates a journey, stay and packing item through local routes", async () => {
  const user = userEvent.setup();
  renderApp();

  await screen.findByRole("heading", { name: "Plan your first journey" });
  await user.click(screen.getAllByRole("link", { name: "Create journey" })[0]!);
  await user.type(screen.getByLabelText(/Journey name/), "Japan spring");
  await user.type(screen.getByLabelText("Start date"), "2027-04-01");
  await user.type(screen.getByLabelText("End date"), "2027-04-20");
  await user.click(screen.getByRole("button", { name: "Create journey" }));

  expect(
    await screen.findByRole("heading", { name: "Japan spring" }),
  ).toBeInTheDocument();
  await user.click(screen.getAllByRole("link", { name: "Timeline" })[0]!);
  await user.click(screen.getByRole("button", { name: "Add stay" }));
  await user.type(screen.getByLabelText("Place"), "Tokyo");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByRole("heading", { name: "Tokyo" }),
  ).toBeInTheDocument();

  await user.click(screen.getAllByRole("link", { name: "Packing" })[0]!);
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await user.type(screen.getByLabelText("Item"), "Passport");
  await user.selectOptions(screen.getByLabelText("Category"), "documents");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const passport = await screen.findByRole("checkbox", { name: "Passport" });
  await user.click(passport);
  expect(screen.getByText("1 of 1 packed")).toBeInTheDocument();
});

test("switches the complete shell to Dutch and persists the choice", async () => {
  const user = userEvent.setup();
  const { journeyRepository } = renderApp();
  await screen.findByRole("heading", { name: "Plan your first journey" });

  await user.selectOptions(screen.getByLabelText("Language"), "nl");

  expect(
    await screen.findByRole("heading", { name: "Plan je eerste reis" }),
  ).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("nl");
  await waitFor(async () =>
    expect(await journeyRepository.loadLocale()).toBe("nl"),
  );
});

test("keeps instance discovery isolated to About and reports API failure", async () => {
  const getInstance = vi
    .fn<InstanceRepository["getInstance"]>()
    .mockRejectedValue(new Error("offline"));
  renderApp("/about", undefined, getInstance);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Instance unavailable",
  );
  expect(
    screen.getByText(/Reconnect before loading or changing Journey data/),
  ).toBeInTheDocument();
  expect(getInstance).toHaveBeenCalledTimes(1);
});

test("renders a privacy-neutral localized not-found page", async () => {
  renderApp("/journeys/unknown");

  expect(
    await screen.findByRole("heading", { name: "Page not found" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("unknown")).not.toBeInTheDocument();
});
