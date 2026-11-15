import { describe, expect, it } from "vitest";
import {
  clampLevel,
  formatDuration,
  insertionLabel,
  isBusy,
  phaseLabel,
} from "./utils";

describe("voice UI helpers", () => {
  it("formats a non-negative recording duration", () => {
    expect(formatDuration(65_900)).toBe("01:05");
    expect(formatDuration(-40)).toBe("00:00");
  });

  it("constrains meter levels to the supported range", () => {
    expect(clampLevel(-0.4)).toBe(0);
    expect(clampLevel(0.42)).toBe(0.42);
    expect(clampLevel(2)).toBe(1);
  });

  it("distinguishes busy voice phases", () => {
    expect(isBusy("recording")).toBe(true);
    expect(isBusy("cleaning")).toBe(true);
    expect(isBusy("done")).toBe(false);
  });

  it("presents insertion outcomes without implying practice pasted text", () => {
    expect(insertionLabel("preview", "")).toMatch(/Practice result/);
    expect(insertionLabel("pasted", "Notepad")).toBe("Inserted into Notepad.");
    expect(phaseLabel("transcribing")).toBe("Transcribing securely");
  });
});
