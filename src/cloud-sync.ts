import { clearPendingUpload, queuePendingUpload, readPendingUpload, type PendingUpload, type ScoreStorage } from "./score-store";
import { saveFirebaseUid, type PlayerProfile } from "./profile";

const SYNCED_PROFILE_KEY = "shill-takeover-synced-profile";

export interface CloudGateway {
  authenticate(): Promise<string>;
  syncPlayer(uid: string, nickname: string, update: PendingUpload): Promise<void>;
}

export type CloudSyncResult =
  | { ok: true; profile: PlayerProfile | null }
  | { ok: false; profile: PlayerProfile | null; phase: "authentication" | "write"; error: unknown };

export class PlayerCloudSync {
  private uid: string | null = null;

  constructor(private readonly gateway: CloudGateway, private readonly storage: ScoreStorage) {}

  async connect(profile: PlayerProfile | null): Promise<CloudSyncResult> {
    try {
      this.uid = await this.gateway.authenticate();
    } catch (error: unknown) {
      this.logFailure("authentication", error);
      return { ok: false, profile, phase: "authentication", error };
    }
    if (!profile) return { ok: true, profile: null };

    const connectedProfile = saveFirebaseUid(this.storage, profile, this.uid);
    const pending = readPendingUpload(this.storage);
    const profileNeedsSync = !this.isProfileSynced(connectedProfile);
    if (profileNeedsSync && pending.nickname !== connectedProfile.nickname) {
      queuePendingUpload(this.storage, { nickname: connectedProfile.nickname });
    }
    const update = readPendingUpload(this.storage);
    if (!profileNeedsSync && !hasUpload(update)) return { ok: true, profile: connectedProfile };
    try {
      await this.gateway.syncPlayer(this.uid, connectedProfile.nickname, update);
      clearPendingUpload(this.storage, update);
      this.markProfileSynced(connectedProfile);
    } catch (error: unknown) {
      this.logFailure("player write", error);
      return { ok: false, profile: connectedProfile, phase: "write", error };
    }
    return { ok: true, profile: connectedProfile };
  }

  async syncNickname(profile: PlayerProfile): Promise<CloudSyncResult> {
    queuePendingUpload(this.storage, { nickname: profile.nickname });
    return this.connect(profile);
  }

  async flushPending(profile: PlayerProfile | null): Promise<CloudSyncResult> {
    return this.connect(profile);
  }

  private logFailure(phase: "authentication" | "player write", error: unknown): void {
    if (!import.meta.env.DEV) return;
    const code = readErrorCode(error);
    console.error(`[Firebase] ${phase} failed (${code ?? "unknown error"}).`);
  }

  private isProfileSynced(profile: PlayerProfile): boolean {
    try {
      const saved = JSON.parse(this.storage.getItem(SYNCED_PROFILE_KEY) ?? "null") as { uid?: string; nickname?: string } | null;
      return saved?.uid === profile.firebaseUid && saved?.nickname === profile.nickname;
    } catch {
      return false;
    }
  }

  private markProfileSynced(profile: PlayerProfile): void {
    try {
      this.storage.setItem(SYNCED_PROFILE_KEY, JSON.stringify({ uid: profile.firebaseUid, nickname: profile.nickname }));
    } catch {
      // A future launch can safely retry the idempotent transaction.
    }
  }
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error) {
    const match = error.message.match(/\b(permission_denied|network_error|disconnected|unavailable)\b/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function hasUpload(update: PendingUpload): boolean {
  return update.nickname !== undefined || update.bestFeet !== undefined || update.bestSurvivalMs !== undefined;
}