// Auto-tests for the TypeScript snippets in
// `dagstack-plugin-system-docs/site/docs/reference/resources-list.mdx`.
//
// The TS TabItems on this page are pure protocol declarations (host-side
// interfaces that the application defines). The published `@dagstack/plugin-system`
// runtime does not yet ship these as exports — they are documentation of the
// shape the host MUST satisfy. We test that classes implementing the documented
// interfaces are well-typed by writing trivial implementations and asserting
// their methods compile + behave.

import { describe, expect, it } from "vitest";

// --- snippet start (resources-list / Clock interface) ----------------
interface Clock {
  now(): Date;
  monotonicNs(): bigint;
}
// --- snippet end ------------------------------------------------------

// --- snippet start (resources-list / Rng interface) ------------------
interface Rng {
  nextFloat(): number; //  [0.0, 1.0)
  nextInt(low: number, high: number): number;
  uuid4(): string;
  choice<T>(items: T[]): T;
}
// --- snippet end ------------------------------------------------------

class FixedClock implements Clock {
  constructor(private readonly t: Date) {}
  now(): Date {
    return this.t;
  }
  monotonicNs(): bigint {
    return BigInt(this.t.getTime()) * 1_000_000n;
  }
}

class SeededRng implements Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  nextFloat(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  nextInt(low: number, high: number): number {
    return low + Math.floor(this.nextFloat() * (high - low));
  }
  uuid4(): string {
    return `00000000-0000-4000-8000-${(this.state >>> 0).toString(16).padStart(12, "0")}`;
  }
  choice<T>(items: T[]): T {
    return items[this.nextInt(0, items.length)];
  }
}

describe("reference/resources-list.mdx — Clock + Rng (TypeScript)", () => {
  it("a class implementing Clock returns the documented shape", () => {
    const at = new Date("2026-04-30T12:00:00Z");
    const clock: Clock = new FixedClock(at);
    expect(clock.now()).toEqual(at);
    expect(typeof clock.monotonicNs()).toBe("bigint");
  });

  it("a class implementing Rng round-trips through every method", () => {
    const rng: Rng = new SeededRng(42);
    const f = rng.nextFloat();
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(1);

    const i = rng.nextInt(10, 20);
    expect(i).toBeGreaterThanOrEqual(10);
    expect(i).toBeLessThan(20);

    const u = rng.uuid4();
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const items = ["a", "b", "c"];
    const pick = rng.choice(items);
    expect(items).toContain(pick);
  });
});
