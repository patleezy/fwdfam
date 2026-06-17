import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

function slugify(email: string): string {
  const localPart = email.split("@")[0] ?? "user";
  const slug = localPart.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "user";
}

export async function generateInboundHandle(email: string, supabase: SupabaseClient): Promise<string> {
  const base = slugify(email);

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomBytes(2).toString("hex");
    const candidate = `${base}-${suffix}`;

    const { data } = await supabase
      .from("users")
      .select("id")
      .eq("inbound_email_handle", candidate)
      .maybeSingle();

    if (!data) return candidate;
  }

  throw new Error("Could not generate a unique inbound email handle");
}
