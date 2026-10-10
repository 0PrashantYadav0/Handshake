import { claude } from "./client";
import { extract } from "./extract";
import { judge } from "./judge";
import type { AiDep } from "./types";

export * from "./types";

export const realAi: AiDep = {
  extract: (input) => extract(input, claude()),
  judge: (input) => judge(input, claude()),
};
