import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppleOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        action="/api/onboarding/apple"
        method="post"
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <h1 className="text-2xl font-semibold">Connect Apple Calendar</h1>
        <p className="text-sm text-neutral-600">
          Generate an app-specific password at{" "}
          <a href="https://appleid.apple.com" className="underline" target="_blank" rel="noreferrer">
            appleid.apple.com
          </a>{" "}
          -- your regular Apple ID password won&apos;t work here.
        </p>

        {error && <p className="text-sm text-red-600">That didn&apos;t work. Double-check your credentials.</p>}

        <label className="flex flex-col gap-1">
          <span>iCloud email</span>
          <input
            type="email"
            name="icloud_email"
            required
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span>App-specific password</span>
          <input
            type="password"
            name="app_password"
            required
            placeholder="xxxx-xxxx-xxxx-xxxx"
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <button type="submit" className="rounded bg-neutral-900 px-3 py-2 text-white">
          Connect
        </button>
      </form>
    </main>
  );
}
