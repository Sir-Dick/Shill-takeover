import { describe, expect, it } from "vitest";
import { buildLeaderboardRows, emptyLeaderboardMessage, type LeaderboardEntry } from "./leaderboard-model";

describe("leaderboard presentation", () => {
  it("provides a useful empty state for either category", () => {
    expect(buildLeaderboardRows([], "feet")).toEqual([]);
    expect(buildLeaderboardRows([
      { uid: "new", nickname: "New Player", bestFeet: 0, bestSurvivalMs: 0 },
    ], "feet")).toEqual([]);
    expect(emptyLeaderboardMessage("feet")).toBe("No feet records yet.");
    expect(emptyLeaderboardMessage("survival")).toBe("No survival records yet.");
  });

  it("ranks populated entries and formats feet and survival scores", () => {
    const entries: LeaderboardEntry[] = [
      { uid: "one", nickname: "Pilot One", bestFeet: 8, bestSurvivalMs: 12000 },
      { uid: "two", nickname: "Pilot Two", bestFeet: 15, bestSurvivalMs: 9500 },
    ];
    expect(buildLeaderboardRows(entries, "feet")).toEqual([
      { rank: 1, nickname: "Pilot Two", score: "15" },
      { rank: 2, nickname: "Pilot One", score: "8" },
    ]);
    expect(buildLeaderboardRows(entries, "survival")).toEqual([
      { rank: 1, nickname: "Pilot One", score: "12.0s" },
      { rank: 2, nickname: "Pilot Two", score: "9.5s" },
    ]);
  });
});