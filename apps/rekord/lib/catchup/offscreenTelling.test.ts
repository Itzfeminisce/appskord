import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATCHUP_SOURCES } from '@/lib/capture';
import { TELL_LIMIT_MS } from '@/lib/catchup/session';

const h = vi.hoisted(() => ({
  handler: undefined as undefined | ((msg: unknown) => unknown),
  send: vi.fn(async (_msg: unknown) => undefined),
  recordings: [] as { firstSeq?: number; stopped: boolean }[],
}));

vi.mock('@/lib/messages', () => ({ onMessage: (fn: (msg: unknown) => unknown) => { h.handler = fn; }, send: h.send }));
vi.mock('@/lib/db', () => ({
  deleteSegment: vi.fn(async () => undefined), deleteTellingAudioFrom: vi.fn(async () => undefined), putChunk: vi.fn(async () => undefined),
  putRecordingMeta: vi.fn(async () => undefined), putRecordingPart: vi.fn(async () => undefined), putSegment: vi.fn(async () => undefined),
}));
vi.mock('@/lib/transcribe', () => ({ drain: async () => undefined, drainAll: async () => undefined, enqueue: () => undefined, startTranscriber: () => undefined }));
vi.mock('@/lib/audio/recorder', () => ({ mediaRecorder: () => ({}), pickMimeType: () => 'audio/webm' }));
vi.mock('@/lib/audio/chunker', () => ({
  Chunker: class { start() {} tick() {} async stop() {} },
}));
vi.mock('@/lib/audio/recording', () => ({
  shouldRecord: () => false,
  sliceRecorder: () => ({}),
  ContinuousRecording: class {
    rec: { firstSeq?: number; stopped: boolean };
    constructor(o: { firstSeq?: number }) { this.rec = { firstSeq: o.firstSeq, stopped: false }; h.recordings.push(this.rec); }
    start() {}
    pause() {}
    resume() {}
    async stop() { this.rec.stopped = true; return true; }
  },
}));

class FakeTrack { stopped = false; stop() { this.stopped = true; } }
const streams: FakeTrack[][] = [];
const getUserMedia = vi.fn(async (_c: unknown) => {
  const tracks = [new FakeTrack()];
  streams.push(tracks);
  return { getTracks: () => tracks, getAudioTracks: () => tracks } as unknown as MediaStream;
});
const getDisplayMedia = vi.fn();

const ask = (msg: unknown) => h.handler!(msg) as Promise<Record<string, unknown>>;
const startTelling = () => ask({ type: 'offscreen/start', streamId: '', meetingId: 'm1', startedAt: 0, sources: CATCHUP_SOURCES, catchup: { offsetMs: 0, part: 0 } });

beforeAll(async () => {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, getDisplayMedia } });
  vi.stubGlobal('AudioContext', class {
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, connect() {}, getFloatTimeDomainData() {} }; }
    async close() {}
  });
  vi.spyOn(browser.runtime.onConnect, 'addListener').mockImplementation(() => undefined);
  await import('@/entrypoints/offscreen/main');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(1_000_000);
  getUserMedia.mockClear();
  h.send.mockClear();
  h.recordings.length = 0;
  streams.length = 0;
});
afterEach(async () => {
  await ask({ type: 'offscreen/stop' });
  vi.useRealTimers();
});

describe('offscreen catch-up', () => {
  it('starts on the microphone only: no tab, screen or tab-capture stream', async () => {
    const tabCapture = vi.spyOn(browser.tabCapture, 'capture').mockImplementation(() => undefined as never);
    expect(await startTelling()).toEqual({ ok: true, tellStart: 1_000_000 });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(getUserMedia.mock.calls[0]![0])).not.toContain('chromeMediaSource');
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(tabCapture).not.toHaveBeenCalled();
  });

  it('stops itself at 60:00 of telling', async () => {
    await startTelling();
    vi.setSystemTime(1_000_000 + TELL_LIMIT_MS - 1000);
    vi.advanceTimersByTime(125);
    expect(h.send).not.toHaveBeenCalledWith({ type: 'recording/stop' });
    vi.setSystemTime(1_000_000 + TELL_LIMIT_MS);
    vi.advanceTimersByTime(125);
    expect(h.send).toHaveBeenCalledWith({ type: 'recording/stop' });
  });

  it('a pause releases the microphone and ends the part; resume asks again and starts the next file', async () => {
    await startTelling();
    const paused = await ask({ type: 'offscreen/pause', on: true, at: 1_000_000 + 60_000 });
    expect(paused).toMatchObject({ ok: true, recorded: true, voicePart: { at: 1_000_000, ms: 60_000, kind: 'voice' } });
    expect(streams[0]!.every((t) => t.stopped)).toBe(true);
    expect(h.recordings[0]).toEqual({ firstSeq: 0, stopped: true });

    expect(await ask({ type: 'offscreen/pause', on: false, at: 1_000_000 + 120_000 })).toEqual({ ok: true });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.recordings[1]).toEqual({ firstSeq: 1_000_000, stopped: false });
    vi.setSystemTime(1_000_000 + 150_000);
    // The second part counts only its own telling; the limit still counts both.
    expect(await ask({ type: 'offscreen/stop' })).toMatchObject({ ok: true, voicePart: { at: 1_120_000, ms: 30_000 } });
    expect(streams[1]!.every((t) => t.stopped)).toBe(true);
  });
});
