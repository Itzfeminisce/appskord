export type ItemKind = 'promise' | 'decision' | 'question';
export type ItemStatus = 'suggested' | 'open' | 'looksDone' | 'done' | 'dropped' | 'answered' | 'replaced' | 'dismissed';

export interface Quote { speaker: string; text: string; meetingId: string; atMs: number }

export interface Person {
  id: string; name: string; email?: string; company?: string;
  aliases: string[];                 // names seen in transcripts and invites
  meetingIds: string[];
  series?: { label: string; since: number };  // "Every Tuesday 10:00 · 6 meetings since Sep"
  createdAt: number; updatedAt: number;
}

export interface MemoryItem {
  id: string; kind: ItemKind; status: ItemStatus;
  text: string;                      // "Send the revised pricing deck"
  quote: Quote;                      // the proof; checked against the transcript before save
  meetingId: string;
  ownerId?: string;                  // promise: who owes it ('me' for the user)
  toId?: string;                     // promise: who it is owed to
  personIds: string[];               // everyone the item touches, for the person page
  due?: string;                      // ISO date 'YYYY-MM-DD'; missing = no date
  snoozedUntil?: number;
  replacesId?: string; replacedById?: string;   // decisions
  history: Quote[];                  // later mentions ("I'm still finishing the deck")
  evidence?: Quote;                  // the "Looks done" quote
  sentTo?: { service: 'gtasks' | 'notion' | 'linear'; url: string; at: number }[];
  dropReason?: 'notNeeded' | 'someoneElse' | 'notAPromise';
  dismissReason?: 'notAPromise' | 'wrongPerson';
  leftOut?: boolean;                 // quote not found; shown under "left out"
  createdAt: number; updatedAt: number;
}

export interface VectorRow { id: string; meetingId: string; atMs: number; endMs: number; text: string; v: Int8Array; scale: number }

export interface LedgerEntry {
  id: string; meetingId?: string;    // missing = not tied to a meeting (backfill, brief)
  service: 'groq' | 'openai' | 'openrouter' | 'anthropic' | 'deepgram' | 'google-calendar' | 'google-tasks' | 'notion' | 'linear' | 'huggingface' | 'gmail' | 'off-record' | 'redaction';
  what: string;                      // "Audio for transcription"
  count: number; firstAt: number; lastAt: number;
}

export interface AgendaItem { id: string; text: string; source: 'invite' | 'promise' | 'question' | 'you'; minutes: number; coveredAtMs?: number; skipped?: boolean }
export interface Agenda { meetingKey: string; items: AgendaItem[]; totalMinutes: number }  // meetingKey = calendar event id or meeting id

export interface MemorySettings {
  recall: boolean;
  clash: boolean;
  brief: { on: boolean; minutes: 5 | 10 | 15 };
  dueReminders: boolean;
  lookBack: { on: boolean; day: 5; hour: 16 };
  tellPeople: boolean;
  searchModel: 'none' | 'asked' | 'ready';
  backfill: 'ask' | 'running' | 'done' | 'declined';
  folder: boolean;
}
