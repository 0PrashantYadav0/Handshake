import { claude } from "./client";
import { extract } from "./extract";
import type { AiDep } from "./types";

export * from "./types";

export const realAi: AiDep = {
  extract: (input) => extract(input, claude()),
  judge: () => Promise.reject(new Error("not implemented: see T-22")),
};
