import { createHmac, timingSafeEqual } from "crypto";

function sign(userId: string): string {
  return createHmac("sha256", process.env.AUTH_STATE_SECRET!).update(userId).digest("base64url");
}

export function createOAuthState(userId: string): string {
  const userIdEncoded = Buffer.from(userId).toString("base64url");
  return `${userIdEncoded}.${sign(userId)}`;
}

export function verifyOAuthState(state: string): string | null {
  const [userIdEncoded, signature] = state.split(".");
  if (!userIdEncoded || !signature) return null;

  const userId = Buffer.from(userIdEncoded, "base64url").toString("utf8");
  const expected = sign(userId);

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  return userId;
}
