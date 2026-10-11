export type LeaderboardCategory = "feet" | "survival";

export interface LeaderboardEntry {
  uid: string;
  nickname: string;
  bestFeet: number;
  bestSurvivalMs: number;
}

export interface LeaderboardRow {
  rank: number;
  nickname: string;
  score: string;
}

export function buildLeaderboardRows(entries: LeaderboardEntry[], category: LeaderboardCategory): LeaderboardRow[] {
  const scoreFor = (entry: LeaderboardEntry) => category === "feet" ? entry.bestFeet : entry.bestSurvivalMs;
  return [...entries]
    .filter((entry) => scoreFor(entry) > 0)
    .sort((a, b) => scoreFor(b) - scoreFor(a) || a.nickname.localeCompare(b.nickname))
    .slice(0, 10)
    .map((entry, index) => ({
      rank: index + 1,
      nickname: entry.nickname,
      score: category === "feet" ? String(entry.bestFeet) : `${(entry.bestSurvivalMs / 1000).toFixed(1)}s`,
    }));
}

export function emptyLeaderboardMessage(category: LeaderboardCategory): string {
  return category === "feet" ? "No feet records yet." : "No survival records yet.";
}