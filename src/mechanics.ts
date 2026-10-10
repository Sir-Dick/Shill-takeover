export const BIBI_CHASE_FEET = 25;

export type Screen = "start" | "running" | "paused" | "game-over" | "results";

export interface RunStats {
  elapsedSeconds: number;
  feet: number;
  bibiTriggered: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createRunStats(): RunStats {
  return { elapsedSeconds: 0, feet: 0, bibiTriggered: false };
}

export function advanceSurvivalTime(current: number, deltaSeconds: number, isRunning: boolean): number {
  if (!isRunning || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;
  return current + deltaSeconds;
}

export function collectFoot(stats: RunStats): { stats: RunStats; chaseStarted: boolean } {
  const feet = stats.feet + 1;
  const chaseStarted = !stats.bibiTriggered && feet === BIBI_CHASE_FEET;
  return {
    stats: { ...stats, feet, bibiTriggered: stats.bibiTriggered || chaseStarted },
    chaseStarted,
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function bibiCaught(bibi: Rect, player: Rect): boolean {
  return intersects(bibi, player);
}

export function nextGameOverScreen(screen: Screen): Screen {
  return screen === "game-over" ? "results" : screen;
}

export function bestTime(previousBest: number, finalTime: number): number {
  return Math.max(previousBest, Number.isFinite(finalTime) ? Math.max(0, finalTime) : 0);
}

export function readPersonalBest(storage: KeyValueStorage, key: string): number {
  try {
    const value = Number.parseFloat(storage.getItem(key) ?? "0");
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function savePersonalBest(storage: KeyValueStorage, key: string, finalTime: number): number {
  const result = bestTime(readPersonalBest(storage, key), finalTime);
  try {
    storage.setItem(key, result.toFixed(2));
  } catch {
    return result;
  }
  return result;
}