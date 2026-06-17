import { randomUUID } from "crypto";
import ical from "ical-generator";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedEvent } from "./types";

interface PushToAppleCalendarArgs {
  icloudEmail: string;
  appPassword: string;
  calDavHomeUrl: string | null;
  userId: string;
  supabase: SupabaseClient;
  event: ExtractedEvent;
}

function basicAuthHeader(icloudEmail: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${icloudEmail}:${appPassword}`).toString("base64")}`;
}

const PROPFIND_CURRENT_USER_PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<A:propfind xmlns:A="DAV:">
  <A:prop>
    <A:current-user-principal/>
  </A:prop>
</A:propfind>`;

const PROPFIND_CALENDAR_HOME_SET = `<?xml version="1.0" encoding="UTF-8"?>
<A:propfind xmlns:A="DAV:" xmlns:B="urn:ietf:params:xml:ns:caldav">
  <A:prop>
    <B:calendar-home-set/>
  </A:prop>
</A:propfind>`;

function extractHref(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>\\s*<[^>]*href[^>]*>([^<]+)</[^>]*href>`, "i"));
  return match ? match[1] : null;
}

async function propfind(url: string, body: string, auth: string): Promise<string> {
  const response = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: auth,
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "0",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`PROPFIND ${url} failed: ${response.status}`);
  }

  return response.text();
}

export async function discoverCalDavHomeUrl(icloudEmail: string, appPassword: string): Promise<string> {
  const auth = basicAuthHeader(icloudEmail, appPassword);
  const base = process.env.CALDAV_BASE_URL ?? "https://caldav.icloud.com";

  const principalXml = await propfind(`${base}/`, PROPFIND_CURRENT_USER_PRINCIPAL, auth);
  const principalHref = extractHref(principalXml, "current-user-principal");
  if (!principalHref) throw new Error("Could not discover CalDAV current-user-principal");

  const principalUrl = new URL(principalHref, base).toString();
  const homeSetXml = await propfind(principalUrl, PROPFIND_CALENDAR_HOME_SET, auth);
  const homeHref = extractHref(homeSetXml, "calendar-home-set");
  if (!homeHref) throw new Error("Could not discover CalDAV calendar-home-set");

  return new URL(homeHref, base).toString();
}

function toIcsDate(event: ExtractedEvent, field: "start_datetime" | "end_datetime"): Date {
  return new Date(event[field]);
}

export async function pushToAppleCalendar({
  icloudEmail,
  appPassword,
  calDavHomeUrl,
  userId,
  supabase,
  event,
}: PushToAppleCalendarArgs): Promise<void> {
  let homeUrl = calDavHomeUrl;

  if (!homeUrl) {
    homeUrl = await discoverCalDavHomeUrl(icloudEmail, appPassword);
    await supabase
      .from("oauth_tokens")
      .update({ caldav_home_url: homeUrl })
      .eq("user_id", userId)
      .eq("provider", "apple");
  }

  const calendar = ical({ name: "FwdFam" });
  calendar.createEvent({
    start: toIcsDate(event, "start_datetime"),
    end: toIcsDate(event, "end_datetime"),
    summary: event.title,
    description: event.description,
    allDay: event.is_all_day,
  });

  const icsString = calendar.toString();
  const eventUid = randomUUID();
  const putUrl = new URL(`${eventUid}.ics`, homeUrl).toString();

  const response = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Authorization: basicAuthHeader(icloudEmail, appPassword),
      "Content-Type": "text/calendar",
    },
    body: icsString,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apple CalDAV PUT failed: ${response.status} ${text}`);
  }
}
