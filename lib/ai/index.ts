import type { AiDep } from "./types";

export * from "./types";

const todo = () => Promise.reject(new Error("not implemented: see T-15"));

export const realAi: AiDep = { extract: todo, judge: todo };
