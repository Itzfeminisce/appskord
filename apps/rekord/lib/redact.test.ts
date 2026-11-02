import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB, getDB, getMeeting, listAsks, listChunks, listNotes, listRecordingParts, listSegments, putAsk, putMeeting, putNote, putSegment } from './db';
import { getItem, ledgerForMeeting, putVectors, tombstones, vectorsForMeeting } from './memory/store';
import { M, SAMPLE_ONE_ON_ONE, seedSample } from './memory/sample';
import {
  canRedactPerson, encodeWav, markFolderWritten, meetingsNeedingFolderWrite, needsFolderWrite, planSpan, redactPerson,
  oggOpus, redactSpan, redactionsOf, silence, summaryWithout, toRecordingMs,
} from './redact';
import { tellSeqBase } from './catchup/session';
import type { Segment } from './types';

const mmss = (m: number, s: number) => (m * 60 + s) * 1000;
const SPAN = { startMs: mmss(21, 10), endMs: mmss(21, 52) };
const NOW = new Date(2026, 10, 3, 10, 41).getTime();
const seg = (m: number, s: number, end: number, text: string, extra: Partial<Segment> = {}): Segment => ({
  id: `x-${m}-${s}`, meetingId: M.sarah3, speaker: 'others', startMs: mmss(m, s), endMs: end, text, chunkId: 'c', ...extra,
});
const quiet = { notify: () => undefined, recording: async () => undefined };
const tinyPcm = () => ({ sampleRate: 10, samples: new Float32Array(mmss(23, 0) / 100).fill(0.5) });

async function world() {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  const db = await getDB();
  await seedSample({ put: (store, value) => db.put(store as never, value as never) }, 'after');
  await db.delete('segments', `s-${M.sarah3}-${mmss(21, 30)}`);
  for (const s of [
    seg(20, 44, mmss(21, 8), 'Okay, the new date works for me.', { speaker: 'you' }),
    seg(21, 10, mmss(21, 28), 'Before I forget, a quick one on budget.', { speakerLabel: 'A' }),
    seg(21, 30, mmss(21, 42), 'Can Northwind pay yearly?', { speakerLabel: 'A' }),
    seg(21, 44, mmss(21, 52), 'Let me think about that and come back to you.', { speaker: 'you' }),
    seg(21, 52, mmss(22, 0), 'Okay. Back to the seat count.', { speakerLabel: 'A' }),
  ]) await putSegment(s);
  await putMeeting({
    ...SAMPLE_ONE_ON_ONE, speakers: { A: { name: 'Sarah' } },
    summary: { overview: 'Rollout moved. Sarah asked: can Northwind pay yearly?', decisions: [{ text: 'Northwind rollout starts 16 Nov', atMs: mmss(19, 2) }], actions: [], questions: ['Can Northwind pay yearly?'], generatedAt: 0, model: 't' },
  });
  await putVectors([
    { id: 'v-in', meetingId: M.sarah3, atMs: mmss(21, 0), endMs: mmss(21, 40), text: 't', v: new Int8Array(2), scale: 1 },
    { id: 'v-out', meetingId: M.sarah3, atMs: mmss(22, 0), endMs: mmss(22, 30), text: 't', v: new Int8Array(2), scale: 1 },
  ]);
  await db.put('recordings', { id: 'r0', meetingId: M.sarah3, seq: 0, blob: new Blob(['a']), mimeType: 'audio/webm' });
}

describe('redactSpan', () => {
  beforeEach(world);

  it('removes the audio, lines, summary line, item and search entries, marks the meeting and records it', async () => {
    let decoded = 0;
    const pcm = { sampleRate: 10, samples: new Float32Array(mmss(23, 0) / 100).fill(0.5) };
    const result = await redactSpan(M.sarah3, SPAN, { ...quiet, now: NOW, decode: async () => { decoded++; return pcm; } });
    expect(decoded).toBe(1);
    expect(result.audio).toBe('silenced');
    const parts = await listRecordingParts(M.sarah3);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.mimeType).toBe('audio/wav');

    const texts = (await listSegments(M.sarah3)).map((s) => s.text);
    expect(texts).toContain('Okay, the new date works for me.');
    expect(texts).toContain('Okay. Back to the seat count.');
    expect(texts).not.toContain('Can Northwind pay yearly?');
    expect(texts).not.toContain('Before I forget, a quick one on budget.');

    expect(await getItem('n-yearly')).toBeUndefined();
    expect(await getItem('n-rollout-16')).toBeDefined();
    expect((await vectorsForMeeting(M.sarah3)).map((v) => v.id)).toEqual(['v-out']);

    const meeting = await getMeeting(M.sarah3);
    expect(meeting?.summary?.questions).toEqual([]);
    expect(meeting?.summary?.overview).toBe('Rollout moved.');
    expect(meeting?.summary?.decisions).toHaveLength(1);
    expect(redactionsOf(meeting)).toEqual([{ ...SPAN, at: NOW }]);
    expect(needsFolderWrite(meeting)).toBe(true);
    expect(await meetingsNeedingFolderWrite()).toHaveLength(1);
    await markFolderWritten(M.sarah3);
    expect(needsFolderWrite(await getMeeting(M.sarah3))).toBe(false);

    const row = (await ledgerForMeeting(M.sarah3)).find((r) => r.service === 'redaction');
    expect(row).toMatchObject({ what: 'Redacted', count: 1, firstAt: NOW });
  });

  it('changes nothing when the recording cannot be decoded', async () => {
    const before = (await listSegments(M.sarah3)).length;
    await expect(redactSpan(M.sarah3, SPAN, { ...quiet, now: NOW, decode: async () => undefined })).rejects.toThrow();
    await expect(redactSpan(M.sarah3, SPAN, { ...quiet, now: NOW, decode: async () => { throw new Error('bad'); } })).rejects.toThrow('bad');
    const parts = await listRecordingParts(M.sarah3);
    expect(parts.map((p) => p.id)).toEqual(['r0']);
    expect(await listSegments(M.sarah3)).toHaveLength(before);
    expect(await getItem('n-yearly')).toBeDefined();
    expect(redactionsOf(await getMeeting(M.sarah3))).toEqual([]);
  });

  it('refuses while this meeting is being recorded', async () => {
    await expect(redactSpan(M.sarah3, SPAN, { ...quiet, recording: async () => M.sarah3, decode: async () => tinyPcm() })).rejects.toThrow();
    expect(await listRecordingParts(M.sarah3)).toHaveLength(1);
    expect(redactionsOf(await getMeeting(M.sarah3))).toEqual([]);
  });

  it('removes notes and ask answers in the span, trims edge chunks and tombstones removed items', async () => {
    const db = await getDB();
    await putNote({ id: 'note-in', meetingId: M.sarah3, atMs: mmss(21, 20), text: 'secret', createdAt: 0 });
    await putNote({ id: 'note-out', meetingId: M.sarah3, atMs: mmss(22, 20), text: 'fine', createdAt: 0 });
    await putAsk({ id: 'ask-cite', meetingId: M.sarah3, createdAt: 0, question: 'q', answer: 'a', citations: [mmss(21, 30)] });
    await putAsk({ id: 'ask-quote', meetingId: M.sarah3, createdAt: 1, question: 'q', answer: 'She asked: Can Northwind pay yearly?' });
    await putAsk({ id: 'ask-ok', meetingId: M.sarah3, createdAt: 2, question: 'q', answer: 'Rollout moved.' });
    await db.put('chunks', { id: 'ch-edge', meetingId: M.sarah3, speaker: 'others', startMs: mmss(21, 0), endMs: mmss(21, 20), mimeType: 'audio/webm', status: 'done', attempts: 1 });
    await db.put('chunks', { id: 'ch-in', meetingId: M.sarah3, speaker: 'others', startMs: mmss(21, 20), endMs: mmss(21, 40), mimeType: 'audio/webm', status: 'done', attempts: 1 });
    await redactSpan(M.sarah3, SPAN, { ...quiet, now: NOW, decode: async () => tinyPcm() });
    expect((await listNotes(M.sarah3)).map((n) => n.id)).toEqual(['note-out']);
    expect((await listAsks(M.sarah3)).map((a) => a.id)).toEqual(['ask-ok']);
    const chunks = await listChunks(M.sarah3);
    expect(chunks.find((c) => c.id === 'ch-in')).toBeUndefined();
    expect(chunks.find((c) => c.id === 'ch-edge')).toMatchObject({ startMs: mmss(21, 0), endMs: SPAN.startMs });
    expect((await tombstones()).has('n-yearly')).toBe(true);
  });

  it('redacts every line one person said, across meetings', async () => {
    expect(canRedactPerson).toBe(true);
    let decoded = 0;
    const out = await redactPerson('p-sarah', { ...quiet, now: NOW, decode: async () => { decoded++; return tinyPcm(); } });
    expect(decoded).toBe(1);
    expect(out.meetings).toBeGreaterThan(1);
    const left = (await listSegments(M.sarah3)).map((s) => s.text);
    expect(left).toEqual(expect.arrayContaining(['Okay, the new date works for me.', 'Let me think about that and come back to you.']));
    expect(left).not.toContain('Okay. Back to the seat count.');
    expect(await getItem('i-q3')).toBeUndefined();
  });
});

describe('redacting a catch-up', () => {
  beforeEach(world);

  it('silences only the voice part a span falls in, at its own time, and keeps the other parts as they are', async () => {
    const told = { at: NOW, ms: mmss(30, 0), parts: [
      { at: NOW, ms: mmss(20, 0), kind: 'voice' as const }, { at: NOW, ms: mmss(1, 0), kind: 'typed' as const }, { at: NOW, ms: mmss(9, 0), kind: 'voice' as const },
    ] };
    await putMeeting({ ...(await getMeeting(M.sarah3))!, source: 'catchup', told });
    const db = await getDB();
    await db.delete('recordings', 'r0');
    await db.put('recordings', { id: 'p0', meetingId: M.sarah3, seq: tellSeqBase(0), blob: new Blob(['first']), mimeType: 'audio/webm' });
    await db.put('recordings', { id: 'p2', meetingId: M.sarah3, seq: tellSeqBase(2), blob: new Blob(['third']), mimeType: 'audio/webm' });
    const decoded: string[] = [];
    let silenced: number[] = [];
    const decode = async (blob: Blob) => {
      decoded.push(await blob.text());
      const pcm = { sampleRate: 10, samples: new Float32Array(mmss(9, 0) / 100).fill(0.5) };
      return pcm;
    };
    const encode = async (pcm: { samples: Float32Array }) => {
      silenced = [pcm.samples.indexOf(0), pcm.samples.lastIndexOf(0)];
      return new Blob(['re'], { type: 'audio/wav' });
    };
    // The span is 21:10-21:52 of the joined telling: part 2 starts at 21:00, so 0:10-0:52 into its own file.
    const out = await redactSpan(M.sarah3, SPAN, { ...quiet, now: NOW, decode, encode });
    expect(out.audio).toBe('silenced');
    expect(decoded).toEqual(['third']);
    expect(silenced).toEqual([100, 520 - 1]);
    const parts = (await listRecordingParts(M.sarah3)).sort((a, b) => a.seq - b.seq);
    expect(parts.map((p) => [p.id, p.seq])).toEqual([['p0', tellSeqBase(0)], [`${M.sarah3}-redacted-2`, tellSeqBase(2)]]);
  });
});

describe('redaction planning', () => {
  it('keeps lines that only touch the span and reopens a decision whose replacement is gone', () => {
    const items = [
      { id: 'new', kind: 'decision', status: 'open', text: 'B', quote: { speaker: 'S', text: 'b', meetingId: 'm', atMs: 50 }, meetingId: 'm', personIds: [], history: [], replacesId: 'old', createdAt: 0, updatedAt: 0 },
      { id: 'old', kind: 'decision', status: 'replaced', text: 'A', quote: { speaker: 'S', text: 'a', meetingId: 'n', atMs: 50 }, meetingId: 'n', personIds: [], history: [], replacedById: 'new', createdAt: 0, updatedAt: 0 },
    ] as const;
    const plan = planSpan({
      meetingId: 'm', span: { startMs: 10, endMs: 100 }, markers: [], chunks: [], vectors: [], items: items.map((i) => ({ ...i, personIds: [], history: [] })),
      segments: [seg(0, 0, 10, 'before'), { ...seg(0, 0, 60, 'inside'), id: 'in', startMs: 20 }, { ...seg(0, 0, 120, 'after'), id: 'after', startMs: 100 }],
    }, 5);
    expect(plan.segmentIds).toEqual(['in']);
    expect(plan.deleteItemIds).toEqual(['new']);
    expect(plan.changedItems[0]).toMatchObject({ id: 'old', status: 'open', updatedAt: 5 });
    expect(plan.changedItems[0]!.replacedById).toBeUndefined();
  });

  it('drops summary lines that quote the span', () => {
    const { summary, removed } = summaryWithout(
      { overview: 'One. Two', decisions: ['Keep this'], actions: [{ text: 'Budget call' }], questions: ['Can Northwind pay yearly?'], generatedAt: 0, model: 'm' },
      { startMs: 0, endMs: 1 }, ['Can Northwind pay yearly?'], ['Budget call'],
    );
    expect(removed).toBe(2);
    expect(summary.decisions).toEqual(['Keep this']);
    expect(summary.overview).toBe('One. Two');
  });

  it('maps meeting time past pauses and silences samples', () => {
    const pauses = [{ atMs: 1000, durationMs: 500 }];
    expect(toRecordingMs(800, pauses)).toBe(800);
    expect(toRecordingMs(1200, pauses)).toBe(1000);
    expect(toRecordingMs(2000, pauses)).toBe(1500);
    const out = silence({ sampleRate: 1000, samples: new Float32Array(10).fill(1) }, 2, 5);
    expect([...out.samples]).toEqual([1, 1, 0, 0, 0, 1, 1, 1, 1, 1]);
    expect(encodeWav(out).size).toBe(44 + 20);
    const pcm = { sampleRate: 1000, samples: new Float32Array(4).fill(1) };
    expect(silence(pcm, 0, 2).samples).toBe(pcm.samples);
  });

  it('wraps Opus packets in Ogg pages', async () => {
    const blob = oggOpus([new Uint8Array(300).fill(1), new Uint8Array(40)], [960, 960], 16_000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(blob.type).toBe('audio/ogg; codecs=opus');
    expect(text.startsWith('OggS')).toBe(true);
    expect(text).toContain('OpusHead');
    expect(text).toContain('OpusTags');
    expect(text.split('OggS')).toHaveLength(4);
    // Last page: end-of-stream flag and granule = pre-skip + both packets.
    const last = text.lastIndexOf('OggS');
    expect(bytes[last + 5]).toBe(4);
    expect(new DataView(bytes.buffer).getUint32(last + 6, true)).toBe(312 + 1920);
  });
});
