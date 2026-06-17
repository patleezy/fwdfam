import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyOAuthState } from "@/lib/oauth-state";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/onboarding?error=google_auth_failed", req.url));
  }

  const userId = verifyOAuthState(state);
  if (!userId) {
    return NextResponse.redirect(new URL("/onboarding?error=invalid_state", req.url));
  }

  const redirectUri = new URL("/api/auth/google/callback", req.url).toString();

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL("/onboarding?error=google_token_exchange_failed", req.url));
  }

  const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

  // Google only returns refresh_token on the user's first consent grant for this app.
  // If it's missing here, a prior grant already exists -- the stored refresh_token still works.
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/onboarding/checkout", req.url));
  }

  const supabase = createServiceClient();

  await supabase.from("oauth_tokens").upsert(
    {
      user_id: userId,
      provider: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope.split(" "),
    },
    { onConflict: "user_id,provider" }
  );

  await supabase.from("users").update({ calendar_provider: "google" }).eq("id", userId);

  return NextResponse.redirect(new URL("/onboarding/checkout", req.url));
}
