import { readPersonalBest, savePersonalBest, type KeyValueStorage } from "./mechanics";
import { PLAYER_PROFILE_KEY, SYNCED_PROFILE_KEY } from "./profile";

export const BEST_TIME_KEY = "shill-takeover-best";
export const BEST_FEET_KEY = `${BEST_TIME_KEY}-feet`;
export const PENDING_UPLOAD_KEY = "shill-takeover-pending-upload";
export const DATA_VERSION_KEY = "shill-takeover-data-version";
export const DATA_VERSION = 2;

export interface ScoreStorage extends KeyValueStorage {
  removeItem(key: string): void;
}

export interface ScoreImprovements {
  bestFeet?: number;
  bestSurvivalMs?: number;
}

export interface PendingUpload extends ScoreImprovements {
  nickname?: string;
}

export interface RecordedRun {
  bestTimeSeconds: number;
  bestFeet: number;
  improvements: ScoreImprovements;
}

export function readLocalScores(storage: ScoreStorage): { bestTimeSeconds: number; bestFeet: number } {
  return {
    bestTimeSeconds: readPersonalBest(storage, BEST_TIME_KEY),
    bestFeet: Math.floor(readPersonalBest(storage, BEST_FEET_KEY)),
  };
}

export function resetLocalGameData(storage: ScoreStorage): boolean {
  try {
    if (storage.getItem(DATA_VERSION_KEY) === String(DATA_VERSION)) return false;
    for (const key of [
      BEST_TIME_KEY,
      BEST_FEET_KEY,
      PENDING_UPLOAD_KEY,
      PLAYER_PROFILE_KEY,
      SYNCED_PROFILE_KEY,
      "shill-takeover-leaderboard-reset-version",
    ]) storage.removeItem(key);
    storage.setItem(DATA_VERSION_KEY, String(DATA_VERSION));
    return true;
  } catch {
    return false;
  }
}

export function recordRun(storage: ScoreStorage, timeSeconds: number, feet: number): RecordedRun {
  const previous = readLocalScores(storage);
  const improvements: ScoreImprovements = {};
  let bestTimeSeconds = previous.bestTimeSeconds;
  let bestFeet = previous.bestFeet;

  if (Number.isFinite(timeSeconds) && timeSeconds > previous.bestTimeSeconds) {
    bestTimeSeconds = savePersonalBest(storage, BEST_TIME_KEY, timeSeconds);
    improvements.bestSurvivalMs = Math.max(0, Math.round(timeSeconds * 1000));
  }
  const safeFeet = Number.isFinite(feet) ? Math.max(0, Math.floor(feet)) : 0;
  if (safeFeet > previous.bestFeet) {
    bestFeet = Math.floor(savePersonalBest(storage, BEST_FEET_KEY, safeFeet));
    improvements.bestFeet = safeFeet;
  }

  if (Object.keys(improvements).length) queuePendingUpload(storage, improvements);
  return { bestTimeSeconds, bestFeet, improvements };
}

export function readPendingUpload(storage: ScoreStorage): PendingUpload {
  try {
    const saved = storage.getItem(PENDING_UPLOAD_KEY);
    if (!saved) return {};
    const value = JSON.parse(saved) as Partial<PendingUpload>;
    return {
      ...(typeof value.nickname === "string" ? { nickname: value.nickname } : {}),
      ...(Number.isFinite(value.bestFeet) && Number(value.bestFeet) >= 0 ? { bestFeet: Math.floor(Number(value.bestFeet)) } : {}),
      ...(Number.isFinite(value.bestSurvivalMs) && Number(value.bestSurvivalMs) >= 0
        ? { bestSurvivalMs: Math.floor(Number(value.bestSurvivalMs)) }
        : {}),
    };
  } catch {
    return {};
  }
}

export function queuePendingUpload(storage: ScoreStorage, update: PendingUpload): void {
  const current = readPendingUpload(storage);
  const next: PendingUpload = {
    ...(update.nickname !== undefined ? { nickname: update.nickname } : current.nickname !== undefined ? { nickname: current.nickname } : {}),
    ...maxField("bestFeet", current.bestFeet, update.bestFeet),
    ...maxField("bestSurvivalMs", current.bestSurvivalMs, update.bestSurvivalMs),
  };
  try {
    storage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(next));
  } catch {
    // Local scores remain authoritative when browser storage is unavailable.
  }
}

export function clearPendingUpload(storage: ScoreStorage, uploaded: PendingUpload): void {
  const current = readPendingUpload(storage);
  const remaining: PendingUpload = { ...current };
  if (uploaded.nickname !== undefined && current.nickname === uploaded.nickname) delete remaining.nickname;
  if (uploaded.bestFeet !== undefined && current.bestFeet === uploaded.bestFeet) delete remaining.bestFeet;
  if (uploaded.bestSurvivalMs !== undefined && current.bestSurvivalMs === uploaded.bestSurvivalMs) delete remaining.bestSurvivalMs;
  try {
    if (!Object.keys(remaining).length && storage.removeItem) storage.removeItem(PENDING_UPLOAD_KEY);
    else storage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(remaining));
  } catch {
    // A retained queue is harmless and will be retried on a later launch.
  }
}

function maxField<K extends "bestFeet" | "bestSurvivalMs">(
  key: K,
  current: number | undefined,
  incoming: number | undefined,
): Partial<Pick<PendingUpload, K>> {
  const value = Math.max(current ?? 0, incoming ?? 0);
  return value > 0 || current === 0 || incoming === 0 ? { [key]: value } as Pick<PendingUpload, K> : {};
}