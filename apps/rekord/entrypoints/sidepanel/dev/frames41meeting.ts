// v4.1 T6 dev frames: the catch-up's meeting page, its More menu and the Meetings list (#/dev/V41<Frame>).
import { createMemoryHistory } from '@appskord/platform/router';
import { createElement as h, type ComponentType, type ReactNode } from 'react';
import { citationCaption } from '@/lib/askAll';
import { tellSeqBase } from '@/lib/catchup/session';
import { getDB, putRecordingPart } from '@/lib/db';
import { catchupHeader } from '@/lib/folder/markdown';
import { seedSampleV41, V41_CATCHUP, V41_ITEMS, V41_QUESTIONS, V41_TOLD_AT } from '@/lib/memory/sample';
import { CATCHUP_EMAIL_LINE } from '@/lib/services/followUp';
import { createRouter } from '../router';
import { summaryView } from '../screens/Summary';
import { Row } from '../screens/v4/Home';
import { meetingLine } from '../screens/v4/loops';
import { PromiseSheet } from '../screens/v4/Promise';
import { AnswerBlock, useMemoryView } from '../screens/v4/parts';
import type { DevFrame } from './frames';

/** Twenty minutes after the telling. */
const NOW = V41_TOLD_AT + 20 * 60_000;
const SUMMARY = {
  overview: 'The Northwind pilot starts with their Support team. You send Sarah the Q4 plan draft by Wed 4 Nov; Tom sets up admin access for the pilot by Fri 6 Nov. Who signs off on the training budget is still open.',
  actions: [], decisions: [], questions: [], generatedAt: NOW, model: 'sample',
};

/** The catch-up with its summary and the telling's voice, as it stands once Processing is done. */
async function meetingWorld() {
  await seedSampleV41(await getDB(), 'after');
  const db = await getDB();
  await db.put('meetings', { ...V41_CATCHUP, summary: SUMMARY });
  await putRecordingPart({ id: 'rec-telling-0', meetingId: V41_CATCHUP.id, seq: tellSeqBase(0), mimeType: 'audio/webm', blob: new Blob([new Uint8Array(8)], { type: 'audio/webm' }) });
}

/** The items as the user kept them in review, so Open loops lists them. */
const keepItems = async () => {
  const db = await getDB();
  for (const i of V41_ITEMS) await db.put('items', { ...i, status: 'open' });
};

const BOARD_CSS = `
.v41b { background: #f6f6f7; padding: 12px; display: flex; flex-direction: column; gap: 14px; font-family: Geist, system-ui, sans-serif; color: #111114; }
.v41b > section { display: flex; flex-direction: column; gap: 8px; position: relative; }
.v41b > section > h2 { margin: 0; padding: 0 4px; font-family: 'Geist Mono', monospace; font-size: 11px; font-weight: 500; color: #6e7079; }
.v41b .lp-list { margin: 0; }
.v41b .lp-sheet { position: static; border-radius: 20px; border: 1px solid #e8e8eb; box-shadow: none; max-height: none; }
.v41b .lp-scrim, .v41b .lp-grab { display: none; }
.v41b .v41b-card { padding: 14px; border-radius: 18px; background: #fff; border: 1px solid #e8e8eb; display: flex; flex-direction: column; gap: 10px; }
.v41b .v41b-line { font-size: 14px; line-height: 1.4; display: flex; flex-direction: column; gap: 3px; }
.v41b .v41b-meta { font-family: 'Geist Mono', monospace; font-size: 11px; color: #6e7079; }
.v41b .v41b-note { margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
`;

/** V41Items: every place a catch-up item shows, stacked on one 400-wide board from the sample world. */
function ItemsBoard() {
  const [view] = useMemoryView();
  if (!view.ready) return null;
  const plan = view.items.find((i) => i.id === 'c-plan-draft');
  const admin = view.items.find((i) => i.id === 'c-admin');
  if (!plan || !admin) return null;
  const meetings = view.meetings;
  const now = V41_TOLD_AT + 24 * 3_600_000;
  const part = (title: string, ...body: ReactNode[]) => h('section', { key: title }, h('h2', null, title), ...body);
  const line = (text: string, meta: string) => h('div', { className: 'v41b-line' }, h('span', null, text), h('span', { className: 'v41b-meta' }, meta));
  const meeting = V41_CATCHUP;
  return h('div', { className: 'lp-stack v41b' }, h('style', null, BOARD_CSS),
    part('Open loops · You owe and Owed to you rows', h('div', { className: 'lp-list' }, [plan, admin].map((i) => h(Row, { key: i.id, item: i, view, now, onCheck: () => undefined })))),
    part('Promise detail · V4Promise sheet for a catch-up item', h(PromiseSheet, { item: plan, view })),
    part('Promise detail · owed to you, due date from a follow-up answer', h(AnswerBlock, { quote: admin.history[0]!, question: V41_QUESTIONS[0]!.text, meetings })),
    part('Brief · V4Brief line for 1:1 with Sarah, Tue 3 Nov', h('div', { className: 'v41b-card' },
      line('You owe Sarah the Q4 plan draft, due Wed 4 Nov.', meetingLine(plan.meetingId, meetings)),
      line(`Decided: ${V41_ITEMS[0]!.text}.`, meetingLine(V41_ITEMS[0]!.meetingId, meetings)))),
    part('Ask all · answer with catch-up citations', h('div', { className: 'v41b-card' },
      line(V41_ITEMS[0]!.text, citationCaption({ atMs: V41_ITEMS[0]!.quote.atMs, catchup: true })),
      line(admin.text, citationCaption({ atMs: admin.quote.atMs, catchup: true })))),
    part('Rekord folder note · header lines', h('p', { className: 'v41b-note v41b-card' }, catchupHeader(meeting).trim().replace(/ {2}\n/g, '\n'))),
    part('Follow-up email · line', h('p', { className: 'v41b-note v41b-card' }, CATCHUP_EMAIL_LINE)));
}

/** The board has no screen of its own, so its parts get a router held in memory. */
const BoardPage: ComponentType = () => {
  const { RouterProvider } = createRouter({ home: ItemsBoard });
  return h(RouterProvider, { initial: { screen: 'home', params: {} }, history: createMemoryHistory({ initialEntries: ['/home'] }) });
};

export const FRAMES_41_MEETING = {
  V41Meeting: { screen: 'summary', params: { meetingId: V41_CATCHUP.id }, now: NOW, setup: meetingWorld },
  V41MeetingMore: {
    screen: 'summary', params: { meetingId: V41_CATCHUP.id }, now: NOW,
    setup: async () => { await meetingWorld(); summaryView.menuOpen = true; },
  },
  V41Library: { screen: 'library', now: NOW, setup: async () => { await meetingWorld(); await keepItems(); } },
  V41Items: { screen: 'home', now: NOW, setup: async () => { await meetingWorld(); await keepItems(); }, page: async () => BoardPage },
} satisfies Record<string, DevFrame>;
