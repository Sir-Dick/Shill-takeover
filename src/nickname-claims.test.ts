import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reserveNickname } from "./nickname-claims";

const databaseRules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8")).rules;

function createAtomicClaimStore() {
  const claims = new Map<string, string>();
  const transact = async (key: string, uid: string) => {
    const owner = claims.get(key);
    if (owner === undefined) {
      claims.set(key, uid);
      return { committed: true, value: uid };
    }
    return { committed: false, value: owner };
  };
  return { claims, transact };
}

describe("unique nickname claims", () => {
  it("allows a unique nickname and treats capitalization as equivalent", async () => {
    const store = createAtomicClaimStore();
    await expect(reserveNickname("  Pilot  ", "uid-one", store.transact)).resolves.toEqual({
      key: "pilot",
      newlyClaimed: true,
    });
    await expect(reserveNickname("PILOT", "uid-two", store.transact)).rejects.toMatchObject({
      code: "nickname/already-exists",
    });
    expect(store.claims.get("pilot")).toBe("uid-one");
  });

  it("allows the existing owner to keep the same nickname regardless of case", async () => {
    const store = createAtomicClaimStore();
    await reserveNickname("Jim", "uid-one", store.transact);
    await expect(reserveNickname("JIM", "uid-one", store.transact)).resolves.toEqual({
      key: "jim",
      newlyClaimed: false,
    });
  });

  it("permits only one of two simultaneous case-insensitive claims", async () => {
    const store = createAtomicClaimStore();
    const results = await Promise.allSettled([
      reserveNickname("Jim", "uid-one", store.transact),
      reserveNickname("jIM", "uid-two", store.transact),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ status: "rejected", reason: { code: "nickname/already-exists" } });
    expect(store.claims.get("jim")).toMatch(/^uid-(one|two)$/);
  });

  it("requires authenticated owner-only claim and player writes in database rules", () => {
    const claimRules = databaseRules.nicknameClaims.$nicknameKey;
    expect(claimRules[".write"]).toBe("auth != null && (!data.exists() || data.val() === auth.uid)");
    expect(claimRules[".validate"]).toContain("newData.val() === auth.uid");
    expect(claimRules[".validate"]).toContain("$nicknameKey.matches(/^[a-z0-9 _-]{2,16}$/)");
    expect(databaseRules.players.$uid[".write"]).toBe("auth != null && auth.uid === $uid");
    expect(databaseRules.players.$uid[".validate"]).toContain("root.child('nicknameClaims')");
  });
});