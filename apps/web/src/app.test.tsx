import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { App } from "./app";
import type { InstanceRepository } from "./repositories/instance-repository";

const instance = {
  application: "Trax OS",
  version: "0.1.0",
  apiVersion: "1",
  capabilities: [
    { key: "foundation.contract-discovery", status: "available" as const },
  ],
};

function renderApp(repository: InstanceRepository, route = "/") {
  window.history.replaceState(null, "", route);
  return render(<App repository={repository} />);
}

test("shows a meaningful loading state", () => {
  const repository: InstanceRepository = {
    getInstance: () => new Promise(() => undefined),
  };

  renderApp(repository);

  expect(
    screen.getByRole("heading", { name: "Connecting to this instance" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Reading its public version/)).toBeInTheDocument();
});

test("shows versioned instance details after loading", async () => {
  const repository: InstanceRepository = {
    getInstance: () => Promise.resolve(instance),
  };

  renderApp(repository);

  expect(await screen.findByText("Instance connected")).toBeInTheDocument();
  expect(screen.getByText("0.1.0")).toBeInTheDocument();
  expect(screen.getByText("v1")).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
});

test("shows an error and retries through the injected repository", async () => {
  const getInstance = vi
    .fn<InstanceRepository["getInstance"]>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(instance);
  const user = userEvent.setup();

  renderApp({ getInstance });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Instance unavailable",
  );
  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByText("Instance connected")).toBeInTheDocument();
  expect(getInstance).toHaveBeenCalledTimes(2);
});

test("marks only the active navigation link as the current page", () => {
  const repository: InstanceRepository = {
    getInstance: () => new Promise(() => undefined),
  };

  renderApp(repository);

  expect(screen.getByRole("link", { name: "Foundation" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "About" })).not.toHaveAttribute(
    "aria-current",
  );
});

test("uses URL routing for the about screen", () => {
  const repository: InstanceRepository = {
    getInstance: () => Promise.resolve(instance),
  };

  renderApp(repository, "/about");

  expect(
    screen.getByRole("heading", { name: "Small, public and reproducible" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "About" })).toHaveClass("active");
  expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Foundation" })).not.toHaveAttribute(
    "aria-current",
  );
});
