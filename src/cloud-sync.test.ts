import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerCloudSync, type CloudGateway } from "./cloud-sync";
import { loadPlayerProfile, savePlayerProfile } from "./profile";
import { queuePendingUpload, readPendingUpload, recordRun, type PendingUpload } from "./score-store";
import { NicknameAlreadyTakenError } from "./nickname-claims";

afterEach(() => vi.restoreAllMocks());

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

describe("cloud score sync", () => {
  it("keeps profile and scores playable offline, then retries pending updates", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createStorage();
    let online = false;
    const updates: PendingUpload[] = [];
    const gateway: CloudGateway = {
      authenticate: async () => {
        if (!online) throw new Error("offline");
        return "stable-uid";
      },
      syncPlayer: async (_uid, _nickname, update) => { updates.push(update); },
    };
    let profile = savePlayerProfile(storage, "Offline Pilot", null, () => "local-id")!;
    const cloud = new PlayerCloudSync(gateway, storage);
    const offlineResult = await cloud.syncNickname(profile);
    expect(offlineResult).toMatchObject({ ok: false, phase: "authentication", error: expect.any(Error) });
    profile = offlineResult.profile ?? profile;
    recordRun(storage, 7, 5);
    expect(readPendingUpload(storage)).toEqual({ nickname: "Offline Pilot", bestFeet: 5, bestSurvivalMs: 7000 });
    expect(loadPlayerProfile(storage)?.localId).toBe("local-id");

    online = true;
    const retryResult = await cloud.flushPending(profile);
    expect(retryResult.ok).toBe(true);
    profile = loadPlayerProfile(storage)!;
    expect(profile.firebaseUid).toBe("stable-uid");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ nickname: "Offline Pilot", bestFeet: 5, bestSurvivalMs: 7000 });
    expect(readPendingUpload(storage)).toEqual({});
  });

  it("does not resend unchanged records and keeps the same UID after a rename", async () => {
    const storage = createStorage();
    const calls: Array<{ uid: string; nickname: string; update: PendingUpload }> = [];
    const gateway: CloudGateway = {
      authenticate: async () => "stable-uid",
      syncPlayer: async (uid, nickname, update) => { calls.push({ uid, nickname, update }); },
    };
    const cloud = new PlayerCloudSync(gateway, storage);
    let profile = savePlayerProfile(storage, "First Name", null, () => "local-id")!;
    const initialResult = await cloud.connect(profile);
    expect(initialResult.ok).toBe(true);
    profile = initialResult.profile!;
    await cloud.connect(profile);
    expect(calls).toHaveLength(1);

    recordRun(storage, 9, 6);
    await cloud.flushPending(profile);
    profile = savePlayerProfile(storage, "Second Name", loadPlayerProfile(storage))!;
    const renameResult = await cloud.syncNickname(profile);
    expect(renameResult.ok).toBe(true);
    profile = renameResult.profile!;
    expect(profile.firebaseUid).toBe("stable-uid");
    expect(calls.at(-1)).toMatchObject({ uid: "stable-uid", nickname: "Second Name" });
    expect(calls.at(-1)?.update).not.toHaveProperty("bestFeet");
    expect(calls.at(-1)?.update).not.toHaveProperty("bestSurvivalMs");
  });

  it("returns the original write error and retains the pending upload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createStorage();
    const firebaseError = Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" });
    const gateway: CloudGateway = {
      authenticate: async () => "stable-uid",
      syncPlayer: async () => { throw firebaseError; },
    };
    const profile = savePlayerProfile(storage, "Pilot", null, () => "local-id")!;
    const result = await new PlayerCloudSync(gateway, storage).connect(profile);

    expect(result).toEqual({ ok: false, profile: { ...profile, firebaseUid: "stable-uid" }, phase: "write", error: firebaseError });
    expect(readPendingUpload(storage)).toEqual({ nickname: "Pilot" });
    expect(console.error).toHaveBeenCalledWith("[Firebase] player write failed (PERMISSION_DENIED).");
  });

  it("logs the permission code from Firebase database errors without a code property", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createStorage();
    const gateway: CloudGateway = {
      authenticate: async () => "stable-uid",
      syncPlayer: async () => { throw new Error("permission_denied at nicknameClaims"); },
    };
    const profile = savePlayerProfile(storage, "Pilot", null, () => "local-id")!;
    const result = await new PlayerCloudSync(gateway, storage).connect(profile);

    expect(result.ok).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[Firebase] player write failed (PERMISSION_DENIED).");
  });

  it("surfaces a nickname conflict without losing queued score records", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createStorage();
    recordRun(storage, 9.5, 7);
    queuePendingUpload(storage, { nickname: "Claimed Name" });
    const gateway: CloudGateway = {
      authenticate: async () => "stable-uid",
      syncPlayer: async () => { throw new NicknameAlreadyTakenError(); },
    };
    const profile = savePlayerProfile(storage, "Claimed Name", null, () => "local-id")!;
    const result = await new PlayerCloudSync(gateway, storage).connect(profile);

    expect(result).toMatchObject({ ok: false, phase: "write", error: { code: "nickname/already-exists" } });
    expect(readPendingUpload(storage)).toEqual({ nickname: "Claimed Name", bestFeet: 7, bestSurvivalMs: 9500 });
  });
});