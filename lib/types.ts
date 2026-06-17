export interface LLMAttachment {
  mimeType: string;
  base64Data: string;
}

export interface LLMPayload {
  emailText: string;
  attachments: LLMAttachment[];
  receivedAt: string;
  timezone: string;
}

export interface ExtractedEvent {
  title: string;
  start_datetime: string;
  end_datetime: string;
  is_all_day: boolean;
  description: string;
  confidence: "high" | "medium" | "low";
}

export interface ExtractionResult {
  events: ExtractedEvent[];
  extraction_notes?: string;
}

export type CalendarProvider = "google" | "apple";

export interface TokenRecord {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  access_token: string | null;
  refresh_token: string;
  token_expiry: string | null;
  scopes: string[] | null;
  caldav_home_url: string | null;
}
