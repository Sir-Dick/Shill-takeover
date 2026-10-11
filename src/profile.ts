export const PLAYER_PROFILE_KEY = "shill-takeover-player-profile";

export interface PlayerProfile {
  localId: string;
  firebaseUid?: string;
  nickname: string;
}

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeNickname(value: string): string | null {
  const nickname = value.trim();
  if (nickname.length < 2 || nickname.length > 16 || !/^[A-Za-z0-9 _-]+$/.test(nickname)) return null;
  return nickname;
}

export function loadPlayerProfile(storage: ProfileStorage): PlayerProfile | null {
  try {
    const saved = storage.getItem(PLAYER_PROFILE_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved) as Partial<PlayerProfile>;
    const nickname = typeof value.nickname === "string" ? normalizeNickname(value.nickname) : null;
    if (!nickname || typeof value.localId !== "string" || !value.localId) return null;
    return {
      localId: value.localId,
      ...(typeof value.firebaseUid === "string" ? { firebaseUid: value.firebaseUid } : {}),
      nickname,
    };
  } catch {
    return null;
  }
}

export function savePlayerProfile(
  storage: ProfileStorage,
  nicknameInput: string,
  existing = loadPlayerProfile(storage),
  createLocalId = createLocalIdFallback,
): PlayerProfile | null {
  const nickname = normalizeNickname(nicknameInput);
  if (!nickname) return null;
  const profile: PlayerProfile = {
    localId: existing?.localId ?? createLocalId(),
    ...(existing?.firebaseUid ? { firebaseUid: existing.firebaseUid } : {}),
    nickname,
  };
  try {
    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile));
    return profile;
  } catch {
    return null;
  }
}

export function saveFirebaseUid(storage: ProfileStorage, profile: PlayerProfile, firebaseUid: string): PlayerProfile {
  const updated = { ...profile, firebaseUid };
  try {
    storage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(updated));
  } catch {
    return profile;
  }
  return updated;
}

function createLocalIdFallback(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}