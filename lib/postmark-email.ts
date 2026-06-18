import { ServerClient } from "postmark";

let client: ServerClient | null = null;

function getClient(): ServerClient {
  if (!client) {
    client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!);
  }
  return client;
}

export async function sendConfirmationEmail(
  to: string | null | undefined,
  subject: string,
  textBody: string
): Promise<void> {
  if (!to) return;
  await getClient().sendEmail({
    From: `FwdFam <confirmations@${process.env.INBOUND_EMAIL_DOMAIN}>`,
    To: to,
    Subject: subject,
    TextBody: textBody,
  });
}
