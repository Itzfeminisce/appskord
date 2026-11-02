/** Go or No-go for each machine check. Pure; the page measures, this decides. */
export type CheckId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Verdict = 'go' | 'no-go';

export interface CheckInfo { id: CheckId; label: string; target: string }

export const CHECKS: CheckInfo[] = [
  { id: 1, label: 'Embed a 1-hour transcript', target: 'under 60 s' },
  { id: 2, label: 'Search 500 meetings', target: 'under 300 ms' },
  { id: 3, label: 'Memory with the model loaded', target: 'under 400 MB' },
  { id: 4, label: 'Extract a 1-hour meeting', target: 'under 60 s' },
  { id: 5, label: 'Recall card latency', target: 'under 15 s' },
  { id: 6, label: 'Notification click opens the side panel', target: 'opens' },
  { id: 7, label: 'Folder access after a restart', target: 'one click' },
  { id: 8, label: 'Google tasks permission', target: 'granted' },
];

export const LIMITS = { embedSeconds: 60, searchMs: 300, memoryMb: 400, extractSeconds: 60, recallSeconds: 15 } as const;

const under = (value: number, limit: number): Verdict => (Number.isFinite(value) && value < limit ? 'go' : 'no-go');

export const scoreEmbed = (seconds: number): Verdict => under(seconds, LIMITS.embedSeconds);
export const scoreSearch = (ms: number): Verdict => under(ms, LIMITS.searchMs);
export const scoreExtract = (seconds: number): Verdict => under(seconds, LIMITS.extractSeconds);
export const scoreRecall = (seconds: number): Verdict => under(seconds, LIMITS.recallSeconds);
/** The worst figure the browser gives us counts; no figure at all is a No-go. */
export const scoreMemory = (mb: (number | undefined)[]): Verdict => {
  const known = mb.filter((x): x is number => x !== undefined && Number.isFinite(x));
  return known.length ? under(Math.max(...known), LIMITS.memoryMb) : 'no-go';
};
export const scoreNotification = (opened: boolean): Verdict => (opened ? 'go' : 'no-go');
/** Chrome says 'granted' when the saved folder works again without a click. */
export const scoreFolder = (permission: 'granted' | 'prompt' | 'denied', oneClick: boolean): Verdict =>
  permission === 'granted' || (permission === 'prompt' && oneClick) ? 'go' : 'no-go';
export const scoreTasks = (granted: boolean): Verdict => (granted ? 'go' : 'no-go');

export interface CheckResult { id: CheckId; verdict?: Verdict; value: string; note?: string }

/** The text X pastes back: one line per check, no keys or tokens. */
export function resultsText(results: CheckResult[], chrome: string): string {
  const by = new Map(results.map((r) => [r.id, r]));
  const lines = CHECKS.map((c) => {
    const r = by.get(c.id);
    const mark = r ? (r.verdict === 'go' ? 'Go' : r.verdict === 'no-go' ? 'No-go' : 'Info') : 'Not run';
    return `${c.id}. ${c.label}: ${r?.value ?? '-'} (target ${c.target}) ${mark}${r?.note ? ` - ${r.note}` : ''}`;
  });
  return ['Rekord machine check', chrome, ...lines].join('\n');
}

/** Synthetic 1-hour transcript: `windows` pieces of text of about 30 s each. */
export function syntheticWindows(windows = 720): string[] {
  const topics = ['the launch date', 'budget for the quarter', 'hiring a designer', 'the customer survey', 'the new onboarding flow', 'a delayed invoice'];
  return Array.from({ length: windows }, (_, i) =>
    `We talked about ${topics[i % topics.length]} for a while. Sam said they would send the notes by Friday, and Priya asked who owns step ${i % 17}. ` +
    'Everyone agreed to look again next week and to keep the plan small, with one owner for each piece of work.');
}

export interface SyntheticSegment { id: string; meetingId: string; speaker: 'you' | 'others'; startMs: number; endMs: number; text: string; chunkId: string }

/** Synthetic 1-hour meeting: one segment every 10 s. */
export function syntheticSegments(meetingId: string, count = 360): SyntheticSegment[] {
  const lines = syntheticWindows(Math.ceil(count / 3));
  return Array.from({ length: count }, (_, i) => ({
    id: `${meetingId}:${i}`, meetingId, speaker: i % 2 ? 'you' : 'others', startMs: i * 10_000, endMs: i * 10_000 + 9_000,
    text: lines[Math.floor(i / 3)]!.split('. ')[i % 3 === 2 ? 1 : 0] ?? lines[0]!, chunkId: 'check',
  }));
}
