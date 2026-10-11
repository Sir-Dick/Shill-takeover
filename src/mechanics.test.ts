import { describe, expect, it } from "vitest";
import {
  advanceSurvivalTime,
  bibiCaught,
  collectFoot,
  createRunStats,
  isOutsidePlayArea,
  intersects,
  intersectsWithClearance,
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

  it("starts Bibi exactly on foot 15 and only once", () => {
    const foot14 = collectFoot({ ...createRunStats(), feet: 13 });
    expect(foot14.stats.feet).toBe(14);
    expect(foot14.chaseStarted).toBe(false);
    const foot15 = collectFoot(foot14.stats);
    expect(foot15.stats.feet).toBe(15);
    expect(foot15.chaseStarted).toBe(true);
    const foot16 = collectFoot(foot15.stats);
    expect(foot16.stats.feet).toBe(16);
    expect(foot16.chaseStarted).toBe(false);
  });

  it("allows 12% of player height above the ceiling without relaxing the ground boundary", () => {
    expect(isOutsidePlayArea(-12, 100, 500)).toBe(false);
    expect(isOutsidePlayArea(-13, 100, 500)).toBe(true);
    expect(isOutsidePlayArea(0, 100, 500)).toBe(false);
    expect(isOutsidePlayArea(401, 100, 500)).toBe(true);
  });

  it("resets the chase threshold for a new run", () => {
    expect(createRunStats()).toEqual({ elapsedSeconds: 0, feet: 0, bibiTriggered: false });
  });

  it("detects Floater/player collisions with axis-aligned hitboxes", () => {
    expect(intersects({ x: 10, y: 10, width: 20, height: 20 }, { x: 25, y: 14, width: 20, height: 20 })).toBe(true);
    expect(intersects({ x: 10, y: 10, width: 20, height: 20 }, { x: 31, y: 10, width: 20, height: 20 })).toBe(false);
  });

  it("detects when hitboxes overlap or are within the required clearance", () => {
    const foot = { x: 10, y: 10, width: 20, height: 20 };
    expect(intersectsWithClearance(foot, { x: 44, y: 10, width: 20, height: 20 }, 15)).toBe(true);
    expect(intersectsWithClearance(foot, { x: 46, y: 10, width: 20, height: 20 }, 15)).toBe(false);
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

  it("tracks best feet independently from best time and initializes missing feet data", () => {
    const values = new Map<string, string>([["best-time", "12.00"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(readPersonalBest(storage, "best-feet")).toBe(0);
    expect(readPersonalBest(storage, "best-time")).toBe(12);

    expect(savePersonalBest(storage, "best-feet", 8)).toBe(8);
    expect(savePersonalBest(storage, "best-time", 10)).toBe(12);
    expect(savePersonalBest(storage, "best-feet", 9)).toBe(9);
    expect(savePersonalBest(storage, "best-feet", 7)).toBe(9);
    expect(readPersonalBest(storage, "best-time")).toBe(12);
    expect(readPersonalBest(storage, "best-feet")).toBe(9);
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