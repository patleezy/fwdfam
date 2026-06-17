import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";

export default async function CheckoutPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("stripe_customer_id, subscription_status")
    .eq("id", data.user.id)
    .single();

  if (userRow?.subscription_status && ["active", "trialing"].includes(userRow.subscription_status)) {
    redirect("/onboarding/success");
  }

  const session = await getStripeClient().checkout.sessions.create({
    mode: "subscription",
    customer: userRow?.stripe_customer_id ?? undefined,
    customer_email: userRow?.stripe_customer_id ? undefined : data.user.email,
    client_reference_id: data.user.id,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  redirect(session.url);
}
