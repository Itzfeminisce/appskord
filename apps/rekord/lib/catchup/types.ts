// Catch-up types shared by every v4.1 task (CONTRACT "Types").
import type { CalendarEvent } from '../types';

export interface Told {
  at: number;                      // epoch ms when the first telling started
  ms: number;                      // total length of all tellings and voice answers
  parts: TellPart[];               // one per telling or "Add more"; segments' startMs are offsets into the joined telling
  typed?: boolean;                 // true when any part was typed or pasted
  answers?: CatchupAnswer[];
  audioDeleted?: boolean;          // "Delete audio of your telling" removes the recording parts, keeps segments
}

export interface TellPart { at: number; ms: number; kind: 'voice' | 'typed' }

export interface CatchupQuestion { id: string; text: string; about: 'owner' | 'due' | 'outcome' | 'name' }
export interface CatchupAnswer { questionId: string; text?: string; skipped?: boolean; atMs?: number } // atMs into the telling, for voice answers

export type CatchupPrompt = 'who' | 'decided' | 'promised' | 'open';
export interface PromptCoverage { prompt: CatchupPrompt; coveredAtMs?: number }

export interface MissedMeeting { event: CalendarEvent; dismissed: boolean }

export interface SomethingElseForm {
  name: string; date: string /* YYYY-MM-DD */; start: string /* HH:MM */; lengthMin: number;
  attendees: { name?: string; email?: string }[];
}
export type PickedMeeting = { kind: 'event'; event: CalendarEvent } | { kind: 'form'; form: SomethingElseForm };

export interface CatchupProgress {
  step: 'text' | 'questions' | 'decisions' | 'promises' | 'summary';
  done: boolean;
  failed?: 'ai' | 'limit' | 'transcribe';
  resumesAt?: number;              // epoch ms when an AI limit lifts
}

/** Dismissed missed-meeting cards: calendar event ids in chrome.storage.local. */
export const DISMISSED_KEY = 'catchup.dismissed';
