import { describe, expect, it } from "vitest";
import {
  advanceSurvivalTime,
  bibiCaught,
  collectFoot,
  createRunStats,
  intersects,
  nextGameOverScreen,
  readPersonalBest,
  savePersonalBest,
} from "./mechanics";

describe("run mechanics", () => {
  it("advances survival time only while the run is active", () => {
    expect(advanceSurvivalTime(4.25, 0.5, true)).toBe(4.75);
    expect(advanceSurvivalTime(4.25, 8, false)).toBe(4.25);
    expect(advanceSurvivalTime(4.25, -2, true)).toBe(4.25);
  });

  it("counts feet and starts Bibi exactly on foot 25, only once", () => {
    let stats = { ...createRunStats(), feet: 23 };
    const foot24 = collectFoot(stats);
    expect(foot24.stats.feet).toBe(24);
    expect(foot24.chaseStarted).toBe(false);
    const foot25 = collectFoot(foot24.stats);
    expect(foot25.stats.feet).toBe(25);
    expect(foot25.chaseStarted).toBe(true);
    const foot26 = collectFoot(foot25.stats);
    expect(foot26.stats.feet).toBe(26);
    expect(foot26.chaseStarted).toBe(false);
  });

  it("resets the chase threshold for a new run", () => {
    expect(createRunStats()).toEqual({ elapsedSeconds: 0, feet: 0, bibiTriggered: false });
  });

  it("detects Floater/player collisions with axis-aligned hitboxes", () => {
    expect(intersects({ x: 10, y: 10, width: 20, height: 20 }, { x: 25, y: 14, width: 20, height: 20 })).toBe(true);
    expect(intersects({ x: 10, y: 10, width: 20, height: 20 }, { x: 31, y: 10, width: 20, height: 20 })).toBe(false);
  });

  it("ends the chase when Bibi's hitbox reaches the player", () => {
    const player = { x: 200, y: 90, width: 60, height: 90 };
    expect(bibiCaught({ x: 100, y: 90, width: 60, height: 90 }, player)).toBe(false);
    expect(bibiCaught({ x: 180, y: 96, width: 40, height: 80 }, player)).toBe(true);
  });

  it("moves from the first game-over screen to results, not past it", () => {
    expect(nextGameOverScreen("game-over")).toBe("results");
    expect(nextGameOverScreen("results")).toBe("results");
    expect(nextGameOverScreen("running")).toBe("running");
  });

  it("saves the best time without lowering an existing record", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(savePersonalBest(storage, "best", 9.75)).toBe(9.75);
    expect(savePersonalBest(storage, "best", 7)).toBe(9.75);
    expect(readPersonalBest(storage, "best")).toBe(9.75);
  });

  it("handles blocked or malformed local storage", () => {
    const brokenStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readPersonalBest(brokenStorage, "best")).toBe(0);
    expect(savePersonalBest(brokenStorage, "best", 5)).toBe(5);
  });
});