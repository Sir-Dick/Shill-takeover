import { describe, expect, it } from "vitest";
import { mergePlayerRecord } from "./player-record";

describe("online player record merging", () => {
  it("never replaces a better online score with a lower local record", () => {
    expect(mergePlayerRecord({
      nickname: "Old Name",
      bestFeet: 40,
      bestSurvivalMs: 25000,
      updatedAt: 100,
    }, "New Name", { bestFeet: 12, bestSurvivalMs: 30000 }, 200)).toEqual({
      nickname: "New Name",
      bestFeet: 40,
      bestSurvivalMs: 30000,
      updatedAt: 200,
    });
  });

  it("initializes absent records with independent score values", () => {
    expect(mergePlayerRecord(null, "Pilot", { bestFeet: 14 }, 200)).toEqual({
      nickname: "Pilot",
      bestFeet: 14,
      bestSurvivalMs: 0,
      updatedAt: 200,
    });
  });
});