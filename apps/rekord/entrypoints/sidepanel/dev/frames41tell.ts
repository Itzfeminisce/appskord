// v4.1 T5 dev frames: telling, typing, the follow-up questions and putting the catch-up together (#/dev/V41<Frame>).
import { CATCHUP_SOURCES } from '@/lib/capture';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import { getDB } from '@/lib/db';
import { seedSampleV41, V41_CATCHUP, V41_EVENT, V41_QUESTIONS, V41_TOLD_AT } from '@/lib/memory/sample';
import { EVENTS_KEY } from '@/lib/reminders';
import type { CatchupProgress } from '@/lib/catchup/types';
import { processingDev } from '../screens/v41/CatchupProcessing';
import { followUpsDev } from '../screens/v41/FollowUps';
import { tellDev } from '../screens/v41/Tell';
import type { DevFrame } from './frames';

const mmss = (m: number, s: number) => (m * 60 + s) * 1000;
/** V41Tell: 06:15 into the telling. */
const TELL_NOW = V41_TOLD_AT + mmss(6, 15);
/** The frame's level meter, bar by bar (3 to 22 px; the 4 and 3 px bars are quiet). */
const METER_PX = [6, 13, 19, 11, 15, 22, 8, 17, 13, 6, 11, 19, 15, 8, 4, 11, 17, 13, 6, 3];
const TYPED = 'Sarah, Tom and Priya were there. We agreed the pilot starts with Northwind’s Support team.\n\nI said I’d send Sarah the Q4 plan draft by Wednesday.';

const seedAfter = async () => seedSampleV41(await getDB(), 'after');
/** The missed Northwind meeting in the cached calendar, as the picker left it. */
const calendar = () => browser.storage.local.set({ [EVENTS_KEY]: { savedAt: V41_TOLD_AT, events: [], past: { [V41_EVENT.id]: V41_EVENT } } });

const step = (s: CatchupProgress['step'], done: boolean): CatchupProgress => ({ step: s, done });

export const FRAMES_41_TELL = {
  V41Tell: {
    screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: TELL_NOW,
    setup: async () => {
      await seedAfter();
      tellDev.levels = METER_PX.map((h) => ((h - 3) / 19) * 0.4);
      tellDev.rec = {
        status: 'recording', meetingId: V41_CATCHUP.id, startedAt: V41_TOLD_AT, micLevel: 0.2, tabLevel: 0, sources: CATCHUP_SOURCES,
        tell: { offsetMs: 0, ms: 0, since: V41_TOLD_AT },
      };
    },
  },
  V41TellType: {
    screen: 'catchupTell', params: { eventId: V41_EVENT.id, mode: 'type' }, now: V41_TOLD_AT + mmss(2, 0),
    setup: async () => {
      await calendar();
      tellDev.typed = TYPED;
    },
  },
  V41Questions: {
    screen: 'catchupQuestions', params: { meetingId: V41_CATCHUP.id }, now: V41_TOLD_AT + mmss(14, 0),
    setup: async () => {
      await seedAfter();
      const told = V41_CATCHUP.told!;
      await (await getDB()).put('meetings', { ...V41_CATCHUP, status: 'processing', told: { ...told, answers: told.answers!.filter((a) => a.questionId !== 'q3') } });
      const states = ['answered', 'skipped', 'open'] as const;
      followUpsDev.questions = { status: 'ready', questions: V41_QUESTIONS };
      followUpsDev.status = { steps: [], decisions: 0, promises: 0, questions: V41_QUESTIONS.map((q, i) => ({ ...q, state: states[i]! })) } satisfies CatchupStatus;
      followUpsDev.draft = 'No, she was there to listen.';
    },
  },
  V41Processing: {
    screen: 'catchupProcessing', params: { meetingId: V41_CATCHUP.id }, now: V41_TOLD_AT + mmss(15, 0),
    setup: async () => {
      await seedAfter();
      processingDev.status = {
        steps: [step('text', true), step('questions', true), step('decisions', true), step('promises', false), step('summary', false)],
        decisions: 1, promises: 0, questions: [],
      };
    },
  },
} satisfies Record<string, DevFrame>;
