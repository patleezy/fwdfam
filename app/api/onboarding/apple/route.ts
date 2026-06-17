import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { discoverCalDavHomeUrl } from "@/lib/calendar-apple";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const formData = await req.formData();
  const icloudEmail = formData.get("icloud_email");
  const appPassword = formData.get("app_password");

  if (typeof icloudEmail !== "string" || typeof appPassword !== "string") {
    return NextResponse.json({ error: "Invalid form submission" }, { status: 400 });
  }

  let calDavHomeUrl: string;
  try {
    calDavHomeUrl = await discoverCalDavHomeUrl(icloudEmail, appPassword);
  } catch {
    return NextResponse.redirect(new URL("/onboarding/apple?error=invalid_credentials", req.url));
  }

  const serviceClient = createServiceClient();

  await serviceClient.from("oauth_tokens").upsert(
    {
      user_id: data.user.id,
      provider: "apple",
      access_token: icloudEmail,
      refresh_token: appPassword,
      caldav_home_url: calDavHomeUrl,
    },
    { onConflict: "user_id,provider" }
  );

  await serviceClient.from("users").update({ calendar_provider: "apple" }).eq("id", data.user.id);

  return NextResponse.redirect(new URL("/onboarding/checkout", req.url), { status: 303 });
}
