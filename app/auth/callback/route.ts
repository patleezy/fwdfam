import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateInboundHandle } from "@/lib/inbound-handle";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Use the service-role client for the existence check and handle generation:
  // RLS only lets a user see their own row, so a session-scoped client could
  // never detect another user's handle and would defeat the uniqueness check.
  const serviceClient = createServiceClient();

  const { data: existingUser } = await serviceClient
    .from("users")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!existingUser) {
    const handle = await generateInboundHandle(data.user.email ?? "user", serviceClient);
    await serviceClient.from("users").insert({
      id: data.user.id,
      email: data.user.email,
      inbound_email_handle: handle,
    });
  }

  return NextResponse.redirect(new URL("/onboarding", req.url));
}
