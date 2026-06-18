import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        action="/api/onboarding/start"
        method="post"
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="text-2xl font-semibold">Set up FwdFam</h1>

        <fieldset className="flex flex-col gap-2">
          <legend>Which calendar do you use?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="calendar_provider" value="google" defaultChecked />
            Google Calendar
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="calendar_provider" value="apple" />
            Apple Calendar
          </label>
        </fieldset>

        <button type="submit" className="rounded bg-neutral-900 px-3 py-2 text-white">
          Continue
        </button>
      </form>
    </main>
  );
}
