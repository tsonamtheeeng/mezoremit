// Injectable clock (tests move time; production uses the wall clock).
let override: (() => Date) | null = null;

export const clock = {
  now(): Date {
    return override ? override() : new Date();
  },
  nowSec(): bigint {
    return BigInt(Math.floor(clock.now().getTime() / 1000));
  },
  set(fn: (() => Date) | null) {
    override = fn;
  },
};

export function addSeconds(d: Date, s: number): Date {
  return new Date(d.getTime() + s * 1000);
}
