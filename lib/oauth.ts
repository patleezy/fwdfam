import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarProvider, TokenRecord } from "./types";

export async function getTokenRecord(
  supabase: SupabaseClient,
  userId: string,
  provider: CalendarProvider
): Promise<TokenRecord> {
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("id, user_id, provider, access_token, refresh_token, token_expiry, scopes, caldav_home_url")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (error || !data) {
    throw new Error(`No ${provider} token record found for user ${userId}`);
  }

  return data as TokenRecord;
}

export async function refreshGoogleAccessToken(tokenRecord: TokenRecord): Promise<string> {
  const isExpired = !tokenRecord.token_expiry || new Date(tokenRecord.token_expiry) <= new Date();
  if (!isExpired && tokenRecord.access_token) {
    return tokenRecord.access_token;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: tokenRecord.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Google access token: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}
