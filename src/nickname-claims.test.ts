import { describe, expect, it } from "vitest";
import { reserveNickname } from "./nickname-claims";

function createAtomicClaimStore() {
  const claims = new Map<string, string>();
  return async (key: string, uid: string) => {
    const owner = claims.get(key);
    if (owner === undefined) {
      claims.set(key, uid);
      return { committed: true, value: uid };
    }
    return { committed: false, value: owner };
  };
}

describe("unique nickname claims", () => {
  it("allows a unique nickname and treats capitalization as equivalent", async () => {
    const transact = createAtomicClaimStore();
    await expect(reserveNickname("  Pilot  ", "uid-one", transact)).resolves.toEqual({
      key: "pilot",
      newlyClaimed: true,
    });
    await expect(reserveNickname("PILOT", "uid-two", transact)).rejects.toMatchObject({
      code: "nickname/already-exists",
    });
  });

  it("allows the existing owner to keep the same nickname regardless of case", async () => {
    const transact = createAtomicClaimStore();
    await reserveNickname("Jim", "uid-one", transact);
    await expect(reserveNickname("JIM", "uid-one", transact)).resolves.toEqual({
      key: "jim",
      newlyClaimed: false,
    });
  });

  it("permits only one of two simultaneous case-insensitive claims", async () => {
    const transact = createAtomicClaimStore();
    const results = await Promise.allSettled([
      reserveNickname("Jim", "uid-one", transact),
      reserveNickname("jIM", "uid-two", transact),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({ status: "rejected", reason: { code: "nickname/already-exists" } });
  });
});