import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function SuccessPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("inbound_email_handle")
    .eq("id", data.user.id)
    .single();

  const handle = userRow?.inbound_email_handle;
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? "mail.fwdfam.app";

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="text-2xl font-semibold">You&apos;re all set</h1>
        <p>Forward any daycare email, PDF, or photo of a flyer to:</p>
        <p className="rounded bg-neutral-100 px-4 py-3 font-mono text-lg">
          {handle}@{inboundDomain}
        </p>
        <p className="text-sm text-neutral-600">
          We&apos;ll add the events to your calendar and text you a confirmation. That&apos;s it.
        </p>
      </div>
    </main>
  );
}
