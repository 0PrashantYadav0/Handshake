export interface Clock {
  now(): Date;
}

export const SystemClock: Clock = { now: () => new Date() };

/** Test clock: now() is fixed until set() or advance() moves it. */
export class FixedClock implements Clock {
  private t: number;
  constructor(iso: string | Date) {
    this.t = new Date(iso).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(iso: string | Date): void {
    this.t = new Date(iso).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export const fixedClock = (iso: string | Date) => new FixedClock(iso);
