import { describe, expect, it } from "vitest";
import { loadPlayerProfile, normalizeNickname, saveFirebaseUid, savePlayerProfile } from "./profile";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("player profile", () => {
  it("trims nicknames and rejects invalid lengths or characters", () => {
    expect(normalizeNickname("  Sky Pilot  ")).toBe("Sky Pilot");
    expect(normalizeNickname("A")).toBeNull();
    expect(normalizeNickname("A name that is too long")).toBeNull();
    expect(normalizeNickname("<script>")).toBeNull();
  });

  it("persists first-time setup and restores the nickname after reload", () => {
    const storage = createStorage();
    const profile = savePlayerProfile(storage, "  Catboy  ", null, () => "local-player-1");
    expect(profile).toEqual({ localId: "local-player-1", nickname: "Catboy" });
    expect(loadPlayerProfile(storage)).toEqual(profile);
  });

  it("changes nickname while preserving local and Firebase identity", () => {
    const storage = createStorage();
    const profile = savePlayerProfile(storage, "First Name", null, () => "local-player-1")!;
    const identified = saveFirebaseUid(storage, profile, "firebase-uid-1");
    const changed = savePlayerProfile(storage, "New Name", identified)!;
    expect(changed).toEqual({ localId: "local-player-1", firebaseUid: "firebase-uid-1", nickname: "New Name" });
    expect(loadPlayerProfile(storage)).toEqual(changed);
  });
});