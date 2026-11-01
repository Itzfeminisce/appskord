import { on, send as sendMessage, type MessageSender } from '@appskord/platform';
import type { CaptureMode, MarkerKind, Quality, Settings } from './types';
import type { BubbleStatus } from './bubble';
import type { RecorderState } from './recorder';
import type { TranscriptStatus } from './transcribe/queue';

/** Runtime messages. Keyboard commands arrive as these; T3 and T5 act on them. */
export type Message =
  | { type: 'recording/toggle' }
  | { type: 'recording/pause' }
  | { type: 'marker/add'; kind: MarkerKind }
  | { type: 'marker/undo'; recordingId: string; id: string }   // the shortcut toast's Undo (T5)
  // Side panel and background → the recorder tab (T3). Prepare opens Chrome's picker there.
  | { type: 'recorder/prepare'; mode: CaptureMode; mic: boolean; sound: boolean; quality: Quality; maxWidth: number; maxHeight: number; camera: boolean; bubble: Settings['bubble'] }
  | { type: 'recorder/bubble'; bubble: Settings['bubble'] }   // corner or size changed (T4)
  | { type: 'recorder/begin' }
  | { type: 'recorder/pause' }
  | { type: 'recorder/resume' }
  | { type: 'recorder/stop' }
  | { type: 'recorder/cancel' }
  | { type: 'recorder/restart' }
  | { type: 'recorder/discard' }
  | { type: 'recorder/mute'; muted: boolean }
  // Recorder tab → background (badge, session state).
  | { type: 'recorder/state'; state: RecorderState }
  | { type: 'recorder/tick'; elapsed: number }
  // Floating camera bubble (T4): the recorder tab answers get and announces each change.
  | { type: 'bubble/get' }
  | { type: 'bubble/status'; status: BubbleStatus }
  // Live transcript (T6): offscreen ↔ background and side panel.
  | { type: 'transcript/config' }                       // offscreen → background: ai, language and Groq key
  | { type: 'transcript/status'; status: TranscriptStatus }
  | { type: 'transcript/get' }                          // → offscreen: the current TranscriptStatus
  | { type: 'offscreen/busy' }                         // → offscreen: true while a stream, a take, a command or a transcript is live
  | { type: 'transcript/use-groq' }                     // "Use Groq for this one"
  | { type: 'transcript/idle' };                        // offscreen → background: nothing left to transcribe or record

export type MessageType = Message['type'];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** Manifest command names (wxt.config.ts) → the message each one sends. */
export const COMMANDS = {
  'toggle-recording': { type: 'recording/toggle' },
  'toggle-pause': { type: 'recording/pause' },
  'add-marker': { type: 'marker/add', kind: 'step' },
} as const satisfies Record<string, Message>;

export function commandMessage(command: string): Message | undefined {
  return (COMMANDS as Record<string, Message>)[command];
}

/** Sends a runtime message; resolves with the reply, or undefined when nothing is listening. */
export const send = <R = unknown>(msg: Message): Promise<R | undefined> => sendMessage<Message, R>(msg);

/** Listens for runtime messages; return undefined from the handler to ignore. Returns an unsubscribe function. */
export const onMessage = (handler: (msg: Message, sender: MessageSender) => unknown): (() => void) => on<Message>(handler);
