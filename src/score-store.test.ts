import { describe, expect, it } from "vitest";
import { readPersonalBest } from "./mechanics";
import {
  BEST_FEET_KEY,
  BEST_TIME_KEY,
  clearPendingUpload,
  PENDING_UPLOAD_KEY,
  queuePendingUpload,
  readLocalScores,
  readPendingUpload,
  recordRun,
} from "./score-store";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("local score storage", () => {
  it("updates only improved categories and preserves both bests independently", () => {
    const storage = createStorage();
    storage.setItem(BEST_TIME_KEY, "12.00");
    storage.setItem(BEST_FEET_KEY, "8.00");

    const feetRun = recordRun(storage, 10, 9);
    expect(feetRun.improvements).toEqual({ bestFeet: 9 });
    expect(readLocalScores(storage)).toEqual({ bestTimeSeconds: 12, bestFeet: 9 });

    const survivalRun = recordRun(storage, 13, 4);
    expect(survivalRun.improvements).toEqual({ bestSurvivalMs: 13000 });
    expect(readLocalScores(storage)).toEqual({ bestTimeSeconds: 13, bestFeet: 9 });
    expect(readPendingUpload(storage)).toEqual({ bestFeet: 9, bestSurvivalMs: 13000 });
  });

  it("does not queue unchanged or lower records", () => {
    const storage = createStorage();
    recordRun(storage, 15, 12);
    const lowerRun = recordRun(storage, 14, 10);
    expect(lowerRun.improvements).toEqual({});
    expect(readPendingUpload(storage)).toEqual({ bestFeet: 12, bestSurvivalMs: 15000 });
  });

  it("clears only the exact uploaded version so newer records remain queued", () => {
    const storage = createStorage();
    queuePendingUpload(storage, { bestFeet: 9, bestSurvivalMs: 13000 });
    queuePendingUpload(storage, { bestSurvivalMs: 14000 });
    clearPendingUpload(storage, { bestFeet: 9, bestSurvivalMs: 13000 });
    expect(readPendingUpload(storage)).toEqual({ bestSurvivalMs: 14000 });
    expect(readPersonalBest(storage, BEST_TIME_KEY)).toBe(0);
    expect(storage.getItem(PENDING_UPLOAD_KEY)).not.toBeNull();
  });
});