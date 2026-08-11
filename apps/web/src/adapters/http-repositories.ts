import { TraxApiClient } from "@trax-os/api-client";

import { HttpAuthRepository } from "./http-auth-repository";
import { HttpInstanceRepository } from "./http-instance-repository";
import { HttpJourneyRepository } from "./http-journey-repository";

export function createHttpRepositories(client = new TraxApiClient()) {
  return {
    authRepository: new HttpAuthRepository(client),
    instanceRepository: new HttpInstanceRepository(client),
    journeyRepository: new HttpJourneyRepository(client),
  };
}
