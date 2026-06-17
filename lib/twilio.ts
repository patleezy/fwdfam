import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  }
  return client;
}

export async function sendSMS(to: string | null | undefined, body: string): Promise<void> {
  if (!to) return;
  await getClient().messages.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    body,
  });
}
