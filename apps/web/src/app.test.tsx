import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

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
      />,
    ),
  };
}

test("starts with an honest local Journey onboarding without calling the API", async () => {
  const { getInstance } = renderApp();

  expect(
    await screen.findByRole("heading", { name: "Plan your first journey" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Local-only")).toBeInTheDocument();
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
    screen.getByText(/Local journeys continue to work/),
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
