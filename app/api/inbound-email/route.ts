import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractEvents } from "@/lib/llm";
import { pushToGoogleCalendar } from "@/lib/calendar-google";
import { pushToAppleCalendar } from "@/lib/calendar-apple";
import { sendConfirmationEmail } from "@/lib/postmark-email";
import { getTokenRecord, refreshGoogleAccessToken } from "@/lib/oauth";
import { convertHeicToJpeg } from "@/lib/image-utils";

export const runtime = "nodejs";

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const SUPPORTED_DOC_TYPES = ["application/pdf"];

interface PostmarkAttachment {
  ContentType?: string;
  Content?: string;
}

interface PostmarkInboundPayload {
  ToFull?: Array<{ Email: string }>;
  TextBody?: string;
  HtmlBody?: string;
  Subject?: string;
  From?: string;
  Date?: string;
  Attachments?: PostmarkAttachment[];
}

function validatePostmarkWebhook(req: NextRequest): boolean {
  const token = req.headers.get("x-postmark-signature") ?? "";
  return token === process.env.POSTMARK_WEBHOOK_TOKEN;
}

export async function POST(req: NextRequest) {
  if (!validatePostmarkWebhook(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // SERVICE ROLE -- server only, never client
  );

  const start = Date.now();
  let userId: string | null = null;

  try {
    const body = (await req.json()) as PostmarkInboundPayload;

    // 1. Resolve user from inbound email handle
    const toAddress = body.ToFull?.[0]?.Email ?? "";
    const handle = toAddress.split("@")[0];
    if (!handle) return NextResponse.json({ error: "No handle" }, { status: 400 });

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, timezone, subscription_status, calendar_provider")
      .eq("inbound_email_handle", handle)
      .single();

    if (userError || !user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    userId = user.id;

    // 2. Guard: subscription must be active or trialing
    if (!["active", "trialing"].includes(user.subscription_status)) {
      await sendConfirmationEmail(
        user.email,
        "FwdFam: subscription inactive",
        "Your FwdFam subscription isn't active. Visit fwdfam.app to reactivate."
      );
      return NextResponse.json({ error: "Inactive subscription" }, { status: 402 });
    }

    // 3. Rate limit: 50 emails/user/day
    const { data: rateData } = await supabase
      .from("user_daily_request_count")
      .select("request_count")
      .eq("user_id", user.id)
      .single();
    if ((rateData?.request_count ?? 0) >= 50) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const emailText = body.TextBody ?? body.HtmlBody ?? "";
    const emailSubject = body.Subject ?? "Forwarded Email";
    const emailFrom = body.From ?? "";
    const receivedAt = body.Date ?? new Date().toISOString();

    // 4. Process attachments -- images and PDFs for LLM vision
    const attachments: Array<{ mimeType: string; base64Data: string }> = [];
    const rawAttachments: PostmarkAttachment[] = body.Attachments ?? [];

    for (const att of rawAttachments) {
      const type = att.ContentType?.toLowerCase() ?? "";

      if (SUPPORTED_IMAGE_TYPES.includes(type) && att.Content) {
        let base64 = att.Content;
        // Convert HEIC (iPhone default format) to JPEG before sending to the LLM
        if (type === "image/heic" || type === "image/heif") {
          base64 = await convertHeicToJpeg(base64);
        }
        attachments.push({ mimeType: "image/jpeg", base64Data: base64 });
      }

      if (SUPPORTED_DOC_TYPES.includes(type) && att.Content) {
        // Gemini 3.1 Flash-Lite accepts PDFs directly as base64 -- pass as-is
        attachments.push({ mimeType: "application/pdf", base64Data: att.Content });
      }
    }

    // 5. Call LLM -- text + all attachments in a single multimodal request
    const extraction = await extractEvents({
      emailText,
      attachments,
      receivedAt,
      timezone: user.timezone,
    });

    // 6. Handle zero events
    if (!extraction.events || extraction.events.length === 0) {
      await supabase.from("email_requests").insert({
        user_id: user.id,
        source_email_from: emailFrom,
        source_email_subject: emailSubject,
        attachment_count: attachments.length,
        events_extracted: 0,
        calendar_provider: user.calendar_provider,
        status: "zero_events",
        processing_ms: Date.now() - start,
      });
      await sendConfirmationEmail(
        user.email,
        "FwdFam: no events found",
        `Hey! We got your email from ${emailFrom} but couldn't find any events. Try forwarding it again or contact support@fwdfam.app.`
      );
      return NextResponse.json({ success: true, events: 0 });
    }

    // 7. Push to calendar -- branch on provider
    let successCount = 0;

    if (user.calendar_provider === "google") {
      const tokenRecord = await getTokenRecord(supabase, user.id, "google");
      const accessToken = await refreshGoogleAccessToken(tokenRecord);
      const results = await Promise.allSettled(
        extraction.events.map((event) => pushToGoogleCalendar(accessToken, event))
      );
      successCount = results.filter((r) => r.status === "fulfilled").length;
    } else if (user.calendar_provider === "apple") {
      // Apple CalDAV: credentials stored in oauth_tokens (provider = 'apple')
      // access_token = iCloud email, refresh_token = app-specific password
      const tokenRecord = await getTokenRecord(supabase, user.id, "apple");
      const results = await Promise.allSettled(
        extraction.events.map((event) =>
          pushToAppleCalendar({
            icloudEmail: tokenRecord.access_token!,
            appPassword: tokenRecord.refresh_token,
            calDavHomeUrl: tokenRecord.caldav_home_url,
            userId: user.id,
            supabase,
            event,
          })
        )
      );
      successCount = results.filter((r) => r.status === "fulfilled").length;
    }

    // 8. Email confirmation
    const eventTitles = extraction.events.slice(0, 3).map((e) => e.title).join(", ");
    const moreCount = extraction.events.length - 3;
    await sendConfirmationEmail(
      user.email,
      `FwdFam: added ${successCount} event${successCount !== 1 ? "s" : ""}`,
      `Added ${successCount} event${successCount !== 1 ? "s" : ""} from ${emailFrom}: ${eventTitles}${moreCount > 0 ? ` + ${moreCount} more` : ""}.`
    );

    // 9. Audit log
    await supabase.from("email_requests").insert({
      user_id: user.id,
      source_email_from: emailFrom,
      source_email_subject: emailSubject,
      attachment_count: attachments.length,
      events_extracted: successCount,
      calendar_provider: user.calendar_provider,
      status: "success",
      processing_ms: Date.now() - start,
    });

    return NextResponse.json({ success: true, events: successCount });
  } catch (err) {
    console.error("[inbound-email] error:", err);
    if (userId) {
      await supabase.from("email_requests").insert({
        user_id: userId,
        events_extracted: 0,
        status: "llm_error",
        error_message: err instanceof Error ? err.message : "Unknown error",
        processing_ms: Date.now() - start,
      });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
