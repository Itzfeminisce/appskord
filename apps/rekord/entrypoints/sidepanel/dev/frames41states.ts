// v4.1 T7 dev frames: every V41States and V41StatesMore card on its real screen (#/dev/V41States<Card>), and the two
// boards, drawn from those same screens (#/dev/V41States, #/dev/V41StatesMore).
import { createMemoryHistory } from '@appskord/platform/router';
import { createElement as h, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { CATCHUP_SOURCES } from '@/lib/capture';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import type { TellClock } from '@/lib/catchup/session';
import type { CatchupProgress } from '@/lib/catchup/types';
import { getDB, putSegment } from '@/lib/db';
import { seedSampleV41, V41_CATCHUP, V41_EVENT, V41_NOW, V41_QUESTIONS, V41_TOLD_AT } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import type { RecordingState } from '@/lib/types';

import { world } from '../components/v4/world';
import { summaryView } from '../screens/Summary';
import { homeDev } from '../screens/v4/Home';
import { processingDev } from '../screens/v41/CatchupProcessing';
import { followUpsDev } from '../screens/v41/FollowUps';
import { DATE_ERROR, NAME_ERROR, pickOtherDev } from '../screens/v41/PickOther';
import { tellDev, type TellDevState } from '../screens/v41/Tell';
import type { DevFrame } from './frames';
import { calendarWorld } from './frames41start';
import { meetingWorld } from './frames41meeting';

const mmss = (m: number, s: number) => (m * 60 + s) * 1000;
const TELL_NOW = V41_TOLD_AT + mmss(6, 15);
const AFTER = V41_TOLD_AT + mmss(15, 0);
/** A level meter mid-sentence (0 to 0.4). */
const LEVELS = [0.06, 0.2, 0.33, 0.17, 0.25, 0.4, 0.1, 0.29, 0.21, 0.06, 0.17];

/** Every dev hook back to the live screen, so one card's state never leaks into the next. */
function reset() {
  for (const k of Object.keys(tellDev)) delete tellDev[k as keyof typeof tellDev];
  for (const k of Object.keys(followUpsDev)) delete followUpsDev[k as keyof typeof followUpsDev];
  for (const k of Object.keys(pickOtherDev)) delete pickOtherDev[k as keyof typeof pickOtherDev];
  delete processingDev.status;
  delete homeDev.wont;
  summaryView.state = undefined;
}

const seedAfter = async () => seedSampleV41(await getDB(), 'after');
const telling = (tell: TellClock): RecordingState => ({
  status: 'recording', meetingId: V41_CATCHUP.id, startedAt: V41_TOLD_AT, micLevel: 0.2, tabLevel: 0, sources: CATCHUP_SOURCES, tell,
});
/** Live at 06:15. */
const LIVE = telling({ offsetMs: 0, ms: mmss(6, 5), since: TELL_NOW - 10_000 });

/** The telling screen with the meeting picked and, when `rec` is given, a telling under way. */
const tellCard = (state: TellDevState, rec?: RecordingState, levels: number[] | null = LEVELS) => async () => {
  await seedAfter();
  await calendarWorld([V41_EVENT]);
  tellDev.state = state;
  if (rec) tellDev.rec = rec;
  if (levels) tellDev.levels = levels;
};

const step = (s: CatchupProgress['step'], done: boolean, extra: Partial<CatchupProgress> = {}): CatchupProgress => ({ step: s, done, ...extra });
const processingCard = (steps: CatchupProgress[], found: number) => async () => {
  await seedAfter();
  processingDev.status = { steps, decisions: found, promises: 0, found, questions: [] };
};
const ALL_DONE = (['text', 'questions', 'decisions', 'promises', 'summary'] as const).map((s) => step(s, true));

/** The questions with q1 answered, q2 skipped and q3 still open, as V41Questions shows them. */
async function questionsWorld() {
  await seedAfter();
  const told = V41_CATCHUP.told!;
  await (await getDB()).put('meetings', { ...V41_CATCHUP, status: 'processing', told: { ...told, answers: told.answers!.filter((a) => a.questionId !== 'q3') } });
  const states = ['answered', 'skipped', 'open'] as const;
  followUpsDev.questions = { status: 'ready', questions: V41_QUESTIONS };
  followUpsDev.status = { steps: [], decisions: 0, promises: 0, found: 0, questions: V41_QUESTIONS.map((q, i) => ({ ...q, state: states[i]! })) } satisfies CatchupStatus;
}

interface StateCard extends DevFrame {
  /** The board's heading, as the frame writes it. */
  label: string;
  board: 'V41States' | 'V41StatesMore';
  /** What the board shows of the screen. */
  pick: (root: ParentNode) => Element[];
  /** The frame draws these parts of a form on a card of their own. */
  wrap?: boolean;
}

const all = (...selectors: string[]) => (root: ParentNode) => selectors.flatMap((s) => [...root.querySelectorAll(s)]);
const near = (id: string, extra: string) => (root: ParentNode) =>
  [root.querySelector(`#${id}`)?.closest('.cu-field'), ...root.querySelectorAll(extra)].filter((e): e is Element => !!e);
const BANNER = '.ct-banners .st4-banner';

const CARDS: Record<string, StateCard> = {
  MicBlocked: {
    label: 'Start · mic blocked', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: V41_TOLD_AT,
    setup: tellCard({ micBlocked: true }, undefined, null), pick: all(BANNER),
  },
  NoAi: {
    label: 'Start · no AI connected', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: V41_TOLD_AT,
    setup: tellCard({ aiMissing: true }, undefined, null), pick: all(BANNER),
  },
  Paused: {
    label: 'Telling · paused', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: TELL_NOW,
    setup: tellCard({}, telling({ offsetMs: 0, ms: mmss(6, 15) })), pick: all('.ct-barwrap', '.ct-row-label'),
  },
  NothingHeard: {
    label: 'Telling · nothing heard', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: TELL_NOW,
    setup: tellCard({}, LIVE, null), pick: all(BANNER, '.ct-row'),
  },
  NearLimit: {
    label: 'Telling · nearing the 60-minute limit', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id },
    now: V41_TOLD_AT + mmss(55, 0), setup: tellCard({}, telling({ offsetMs: 0, ms: mmss(54, 50), since: V41_TOLD_AT + mmss(54, 50) })),
    pick: all('.ct-barwrap', BANNER),
  },
  AtLimit: {
    label: 'Telling · at the limit', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: V41_TOLD_AT + mmss(60, 0),
    setup: tellCard({ limitHit: true }, undefined, null), pick: all(BANNER),
  },
  Leave: {
    label: '(new) Telling · leave while talking (back or close)', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id },
    now: TELL_NOW, setup: tellCard({ confirm: true }, LIVE), pick: all('[role="dialog"]'),
  },
  TooSoon: {
    label: '(new) Telling · stopped too soon', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id },
    now: V41_TOLD_AT + 20_000, setup: tellCard({ short: true }, telling({ offsetMs: 0, ms: 0, since: V41_TOLD_AT })), pick: all(BANNER),
  },
  Offline: {
    label: '(new) Telling · offline', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: TELL_NOW,
    setup: tellCard({ offline: true }, LIVE), pick: all(BANNER),
  },
  TextFailed: {
    label: 'Telling · transcription failed', board: 'V41States', screen: 'catchupTell', params: { eventId: V41_EVENT.id }, now: TELL_NOW,
    setup: tellCard({ textFailed: true }, LIVE), pick: all(BANNER),
  },
  NoQuestions: {
    label: '(new) Questions · nothing to ask', board: 'V41States', screen: 'catchupQuestions', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: async () => {
      await seedAfter();
      followUpsDev.questions = { status: 'ready', questions: [] };
      followUpsDev.status = { steps: [], decisions: 0, promises: 0, found: 0, questions: [] };
    },
    pick: all('.ct-none'),
  },
  NothingFound: {
    label: 'After · nothing found to remember', board: 'V41States', screen: 'catchupProcessing', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: processingCard(ALL_DONE, 0), pick: all('.ct-proc .st4-banner'),
  },
  Dismissed: {
    label: 'Home · missed-meeting card dismissed', board: 'V41States', screen: 'home', now: V41_NOW,
    setup: async () => { await calendarWorld([V41_EVENT]); homeDev.wont = V41_EVENT; }, pick: all('.lp-toast'),
  },
  Adding: {
    label: '(new) Meeting page · adding more', board: 'V41States', screen: 'catchupTell', params: { meetingId: V41_CATCHUP.id },
    now: V41_TOLD_AT + mmss(40, 0), setup: tellCard({}, telling({ offsetMs: mmss(12, 40), ms: 0, since: V41_TOLD_AT + mmss(40, 0) - 24_000 })),
    pick: all('.ct-barwrap', '.ct-note'),
  },
  DeleteConfirm: {
    label: '(new) Meeting page · delete this catch-up', board: 'V41States', screen: 'summary', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: async () => { await meetingWorld(); summaryView.state = 'confirm'; }, pick: all('.sm-confirm'),
  },
  Deleted: {
    label: 'Meeting page · catch-up deleted', board: 'V41States', screen: 'summary', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: async () => { await meetingWorld(); summaryView.state = 'gone'; }, pick: all('.sm-gone .st4-banner'),
  },
  AudioDeleted: {
    label: '(new) Meeting page · telling audio deleted', board: 'V41States', screen: 'summary', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: async () => { await meetingWorld(); summaryView.state = 'audioGone'; }, pick: all('.lp-toast'),
  },
  NoMissed: {
    label: '(new) Pick · no missed meetings', board: 'V41States', screen: 'catchupPick', now: V41_NOW,
    setup: () => calendarWorld([]), pick: all('.cu-empty'),
  },
  NoCalendar: {
    label: '(new) Pick · no calendar connected', board: 'V41States', screen: 'catchupPick', now: V41_NOW,
    setup: async () => { const s = await getSettings(); await updateSettings({ google: { ...s.google, calendar: false } }); }, pick: all('.cu-body .st4-banner'),
  },
  ProcessingFailed: {
    label: '(new) Processing · couldn’t finish', board: 'V41StatesMore', screen: 'catchupProcessing', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: processingCard([step('text', true), step('questions', true), step('decisions', true), step('promises', true), step('summary', false, { failed: 'ai' })], 1),
    pick: all('.ct-proc .st4-banner'),
  },
  AiLimit: {
    label: '(new) Processing · AI free limit used up', board: 'V41StatesMore', screen: 'catchupProcessing', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: processingCard([step('text', true), step('questions', true), step('decisions', false, { failed: 'limit', resumesAt: V41_TOLD_AT + mmss(35, 0) }),
      step('promises', false, { failed: 'limit', resumesAt: V41_TOLD_AT + mmss(35, 0) }), step('summary', false)], 0),
    pick: all('.ct-proc .st4-banner'),
  },
  Voice: {
    label: '(new) Questions · answering by voice (mic on)', board: 'V41StatesMore', screen: 'catchupQuestions', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: async () => {
      await questionsWorld();
      const from = mmss(13, 0);
      await putSegment({ id: 's-voice-q3', meetingId: V41_CATCHUP.id, speaker: 'you', startMs: from + 500, endMs: from + 3_000, text: 'No, she was there to listen.', chunkId: 'sample' });
      followUpsDev.voice = { questionId: 'q3', fromMs: from, levels: LEVELS };
    },
    pick: all('section[aria-label="Question 3"]'),
  },
  Reopened: {
    label: '(new) Questions · card reopened after Change', board: 'V41StatesMore', screen: 'catchupQuestions', params: { meetingId: V41_CATCHUP.id }, now: AFTER,
    setup: async () => { await questionsWorld(); followUpsDev.reopened = 'q1'; followUpsDev.draft = 'By Friday.'; },
    pick: all('section[aria-label="Question 1"]'),
  },
  NoName: {
    label: '(new) Something else · no name', board: 'V41StatesMore', screen: 'catchupPickOther', now: V41_NOW,
    setup: async () => { pickOtherDev.errors = { name: NAME_ERROR }; }, pick: near('f-name', '.cu-foot button'), wrap: true,
  },
  FutureDate: {
    label: '(new) Something else · date in the future', board: 'V41StatesMore', screen: 'catchupPickOther', now: V41_NOW,
    setup: async () => { pickOtherDev.date = '2026-11-05'; pickOtherDev.errors = { date: DATE_ERROR }; }, pick: near('f-date', '#f-date-msg, .cu-foot button'), wrap: true,
  },
};

const routeOf = ({ screen, params, now, setup }: StateCard): DevFrame => ({ screen, params, now, setup: async () => { reset(); await setup?.(); } });

const BOARD_CSS = `
.v41s { background: #f6f6f7; padding: 20px 12px; display: flex; flex-direction: column; gap: 22px; font-family: Geist, system-ui, sans-serif; color: #111114; min-height: 100%; }
.v41s > section { display: flex; flex-direction: column; gap: 8px; }
.v41s > section > h2 { margin: 0; padding: 0 4px; font-family: 'Geist Mono', monospace; font-size: 11px; font-weight: 500; color: #6e7079; }
.v41s .lp-toast, .v41s .sm-confirm, .v41s .ct-barwrap { position: static; inset: auto; transform: none; width: auto; margin: 0; }
.v41s .ct-row, .v41s .ct-note { margin: 0; padding-left: 4px; padding-right: 4px; }
.v41s .ct-barwrap { padding: 0; }
.v41s .ct-bar-back, .v41s .ct-switch { display: none; }
.v41s .ct-bar { padding-left: 14px; }
.v41s section > div > .ct-row-label { display: block; margin: 0; padding: 0 4px; font-size: 12.5px; color: #44464d; }
.v41s .v41s-card { padding: 14px; border-radius: 18px; background: #fff; border: 1px solid #e8e8eb; display: flex; flex-direction: column; gap: 12px; }
`;

/** Mounts one card's screen off screen, waits for its state to show, and keeps a copy of what the board shows. */
async function capture(card: StateCard): Promise<string> {
  const { sidepanel } = await import('../App');
  reset();
  world.now = () => card.now ?? V41_NOW;
  await card.setup?.();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;height:600px;overflow:hidden;';
  document.body.append(host);
  const root = createRoot(host);
  root.render(h(sidepanel.RouterProvider, {
    initial: { screen: card.screen, params: card.params ?? {} },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  }));
  let html = '';
  for (let i = 0; i < 80; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    const found = card.pick(host);
    if (found.length && found.every((e) => e.textContent?.trim())) { await new Promise((r) => setTimeout(r, 150)); html = card.pick(host).map((e) => e.outerHTML).join(''); break; }
  }
  root.unmount();
  host.remove();
  if (!html) console.error('Rekord: could not draw the state card', card.label);
  return html;
}

function boardPage(board: StateCard['board']): ComponentType {
  const cards = Object.values(CARDS).filter((c) => c.board === board);
  return function Board() {
    const [shown, setShown] = useState<string[]>([]);
    useEffect(() => {
      let alive = true;
      (async () => {
        const out: string[] = [];
        for (const c of cards) out.push(await capture(c));
        reset();
        if (alive) setShown(out);
      })().catch((error) => console.error('Rekord: could not draw the states board', error));
      return () => { alive = false; };
    }, []);
    return h('div', { className: 'v41s', 'data-board-loading': shown.length ? undefined : 'true' }, h('style', null, BOARD_CSS),
      shown.map((html, i) => h('section', { key: cards[i]!.label }, h('h2', null, cards[i]!.label), h('div', { className: cards[i]!.wrap ? 'v41s-card' : undefined, style: cards[i]!.wrap ? undefined : { display: 'contents' }, dangerouslySetInnerHTML: { __html: html } }))));
  };
}

export const FRAMES_41_STATES: Record<string, DevFrame> = {
  ...Object.fromEntries(Object.entries(CARDS).map(([k, c]) => [`V41States${k}`, routeOf(c)])),
  V41States: { screen: 'home', now: V41_NOW, page: async () => boardPage('V41States') },
  V41StatesMore: { screen: 'home', now: V41_NOW, page: async () => boardPage('V41StatesMore') },
};

/** The state cards' routes, for tests. */
export const STATE_CARDS = CARDS as Readonly<Record<string, Pick<StateCard, 'label' | 'board' | 'screen'>>>;
