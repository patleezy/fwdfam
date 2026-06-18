import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const formData = await req.formData();
  const calendarProvider = formData.get("calendar_provider");

  if (calendarProvider !== "google" && calendarProvider !== "apple") {
    return NextResponse.json({ error: "Invalid form submission" }, { status: 400 });
  }

  const nextUrl =
    calendarProvider === "google"
      ? new URL("/api/auth/google/start", req.url)
      : new URL("/onboarding/apple", req.url);

  return NextResponse.redirect(nextUrl, { status: 303 });
}
