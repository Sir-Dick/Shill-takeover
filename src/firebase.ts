import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, signInAnonymously } from "firebase/auth";
import { get, getDatabase, limitToLast, orderByChild, query, ref, runTransaction } from "firebase/database";
import { PlayerCloudSync, type CloudSyncResult } from "./cloud-sync";
import { queuePendingUpload, type PendingUpload, type ScoreImprovements } from "./score-store";
import type { LeaderboardCategory, LeaderboardEntry } from "./leaderboard-model";
import { mergePlayerRecord, type PlayerRecord } from "./player-record";
import { loadPlayerProfile, normalizeNickname } from "./profile";

const firebaseConfig = {
  apiKey: "AIzaSyAY9VpKegXiTBZgKCHW1tgV2nJGfaQY5GZw",
  authDomain: "shill-takeover.firebaseapp.com",
  databaseURL: "https://shill-takeover-default-rtdb.firebaseio.com",
  projectId: "shill-takeover",
  storageBucket: "shill-takeover.firebasestorage.app",
  messagingSenderId: "1010577923571",
  appId: "1:1010577923571:web:e0a7ed17a9dfa758fbc686",
  measurementId: "G-ZF3YX0B68R",
};
const LEADERBOARD_TIMEOUT_MS = 6000;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app, firebaseConfig.databaseURL);
let authentication: Promise<string> | null = null;

export function authenticatePlayer(): Promise<string> {
  authentication ??= (async () => {
    await setPersistence(auth, browserLocalPersistence);
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    return user.uid;
  })().catch((error: unknown) => {
    authentication = null;
    throw error;
  });
  return authentication;
}

export async function syncPlayer(uid: string, nickname: string, update: PendingUpload): Promise<void> {
  const playerRef = ref(database, `players/${uid}`);
  await runTransaction(playerRef, (current) => {
    const merged = mergePlayerRecord(current as Partial<PlayerRecord> | null, nickname, update, Date.now());
    if (
      current &&
      current.nickname === merged.nickname &&
      current.bestFeet === merged.bestFeet &&
      current.bestSurvivalMs === merged.bestSurvivalMs
    ) return;
    return merged;
  }, { applyLocally: false });
}

export async function fetchLeaderboard(category: LeaderboardCategory): Promise<LeaderboardEntry[]> {
  const scoreKey = category === "feet" ? "bestFeet" : "bestSurvivalMs";
  const leaderboardQuery = query(ref(database, "players"), orderByChild(scoreKey), limitToLast(10));
  let snapshot: Awaited<ReturnType<typeof get>>;
  try {
    snapshot = await new Promise<Awaited<ReturnType<typeof get>>>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Leaderboard request timed out.")), LEADERBOARD_TIMEOUT_MS);
      void get(leaderboardQuery).then(
        (result) => {
          window.clearTimeout(timeout);
          resolve(result);
        },
        (error: unknown) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      );
    });
  } catch (error: unknown) {
    if (import.meta.env.DEV) console.error("[Firebase] Leaderboard read failed.", error);
    throw error;
  }
  const entries: LeaderboardEntry[] = [];
  snapshot.forEach((player) => {
    const value = player.val() as Partial<LeaderboardEntry>;
    const nickname = typeof value.nickname === "string" ? normalizeNickname(value.nickname) : null;
    if (!nickname) return;
    entries.push({
      uid: player.key ?? "",
      nickname,
      bestFeet: Number(value.bestFeet) || 0,
      bestSurvivalMs: Number(value.bestSurvivalMs) || 0,
    });
  });
  return entries;
}

export const firebaseGateway = { authenticate: authenticatePlayer, syncPlayer };

const playerCloudSync = new PlayerCloudSync(firebaseGateway, localStorage);

export function connectPlayerProfile(profile: ReturnType<typeof loadPlayerProfile>) {
  return playerCloudSync.connect(profile);
}

export function retryPendingUploads(profile: ReturnType<typeof loadPlayerProfile>): Promise<CloudSyncResult> {
  return playerCloudSync.flushPending(profile);
}

export async function submitNewPersonalBest(improvements: ScoreImprovements): Promise<CloudSyncResult | null> {
  if (improvements.bestFeet === undefined && improvements.bestSurvivalMs === undefined) return null;
  queuePendingUpload(localStorage, improvements);
  const profile = loadPlayerProfile(localStorage);
  if (!profile) return null;
  return playerCloudSync.flushPending(profile);
}