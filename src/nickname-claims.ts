import { normalizeNickname } from "./profile";

export interface NicknameClaimTransactionResult {
  committed: boolean;
  value: string | null;
}

export type NicknameClaimTransaction = (key: string, uid: string) => Promise<NicknameClaimTransactionResult>;

export class NicknameAlreadyTakenError extends Error {
  readonly code = "nickname/already-exists";

  constructor() {
    super("That nickname is already in use.");
    this.name = "NicknameAlreadyTakenError";
  }
}

export function normalizedNicknameKey(value: string): string {
  const nickname = normalizeNickname(value);
  if (!nickname) throw new Error("Nickname is invalid.");
  return nickname.toLowerCase();
}

export async function reserveNickname(
  nickname: string,
  uid: string,
  transact: NicknameClaimTransaction,
): Promise<{ key: string; newlyClaimed: boolean }> {
  const key = normalizedNicknameKey(nickname);
  const result = await transact(key, uid);
  if (result.value !== uid) throw new NicknameAlreadyTakenError();
  return { key, newlyClaimed: result.committed };
}