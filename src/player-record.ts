import type { PendingUpload } from "./score-store";

export interface PlayerRecord {
  nickname: string;
  bestFeet: number;
  bestSurvivalMs: number;
  updatedAt: number;
}

export function mergePlayerRecord(
  current: Partial<PlayerRecord> | null,
  nickname: string,
  update: PendingUpload,
  updatedAt: number,
): PlayerRecord {
  return {
    nickname,
    bestFeet: Math.max(validScore(current?.bestFeet), validScore(update.bestFeet)),
    bestSurvivalMs: Math.max(validScore(current?.bestSurvivalMs), validScore(update.bestSurvivalMs)),
    updatedAt,
  };
}

function validScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}