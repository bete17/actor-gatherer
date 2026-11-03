// Times, counts and words as the page says them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ago, firstLine, full, lasting, plural, spell } from "./format";

afterEach(() => vi.useRealTimers());

describe("format", () => {
  it("counts", () => {
    expect([full(1204.4), full(null), plural(1, "message"), plural(3, "turn"), plural(1500, "line")]).toEqual([
      "1,204",
      "–",
      "1 message",
      "3 turns",
      "1,500 lines",
    ]);
  });

  it("cuts a text to its first line", () => {
    expect([firstLine("a\nb"), firstLine("abcdef", 3), firstLine(null), firstLine(undefined, 2)]).toEqual([
      "a",
      "abc…",
      "",
      "",
    ]);
  });

  it("says how long ago, and how long", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000_000);
    const now = 1_000_000;
    expect([ago(now - 44.6), ago(now - 150), ago(now - 7200), ago(now - 3 * 86400), ago(0), ago(now + 5)]).toEqual([
      "45s ago",
      "3m ago",
      "2h ago",
      "3d ago",
      "never",
      "0s ago",
    ]);
    expect([spell(45.9), spell(125), spell(4320), spell(-1), lasting(now - 61)]).toEqual([
      "45s",
      "2m 05s",
      "1h 12m",
      "0s",
      "1m 01s",
    ]);
  });
});
