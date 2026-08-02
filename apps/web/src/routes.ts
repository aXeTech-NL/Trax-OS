export type AppRoute =
  | { readonly name: "journeys" }
  | { readonly name: "journey-new" }
  | { readonly name: "journey"; readonly journeyId: string }
  | { readonly name: "timeline"; readonly journeyId: string }
  | { readonly name: "packing"; readonly journeyId: string }
  | { readonly name: "settings" }
  | { readonly name: "about" }
  | { readonly name: "not-found" };

export function parseRoute(pathname: string): AppRoute {
  if (pathname === "/") return { name: "journeys" };
  if (pathname === "/journeys/new") return { name: "journey-new" };
  if (pathname === "/settings/data") return { name: "settings" };
  if (pathname === "/about") return { name: "about" };
  const match = /^\/journeys\/([^/]+)(?:\/(timeline|packing))?$/.exec(pathname);
  if (!match?.[1]) return { name: "not-found" };
  let journeyId: string;
  try {
    journeyId = decodeURIComponent(match[1]);
  } catch {
    return { name: "not-found" };
  }
  if (match[2] === "timeline") return { name: "timeline", journeyId };
  if (match[2] === "packing") return { name: "packing", journeyId };
  return { name: "journey", journeyId };
}

export const routes = {
  journeys: "/",
  newJourney: "/journeys/new",
  journey: (id: string) => `/journeys/${encodeURIComponent(id)}`,
  timeline: (id: string) => `/journeys/${encodeURIComponent(id)}/timeline`,
  packing: (id: string) => `/journeys/${encodeURIComponent(id)}/packing`,
  settings: "/settings/data",
  about: "/about",
} as const;
