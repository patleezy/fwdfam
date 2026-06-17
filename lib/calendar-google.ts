import type { ExtractedEvent } from "./types";

export async function pushToGoogleCalendar(accessToken: string, event: ExtractedEvent): Promise<void> {
  const body = event.is_all_day
    ? {
        summary: event.title,
        description: event.description,
        start: { date: event.start_datetime.slice(0, 10) },
        end: { date: event.end_datetime.slice(0, 10) },
      }
    : {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.start_datetime },
        end: { dateTime: event.end_datetime },
      };

  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar push failed: ${response.status} ${text}`);
  }
}
