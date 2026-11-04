import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
const saves: unknown[] = [];
let cfg: Record<string, unknown> = {};
const workers: unknown[] = [];

vi.mock('@/lib/messages', () => ({
  send: async (m: { type: string }) => {
    sent.push(m);
    return m.type === 'transcript/config' ? cfg : undefined;
  },
}));
vi.mock('@/lib/db', () => ({ updateRecording: async (_id: string, patch: unknown) => void saves.push(patch) }));

const local = { provider: 'local', model: 'whisper', language: 'auto', key: null, groqKey: null };
const track = {} as MediaStreamTrack;

beforeEach(() => {
  vi.resetModules();
  sent.length = saves.length = workers.length = 0;
  vi.stubGlobal('Worker', class { constructor() { workers.push(this); } terminate() {} postMessage() {} });
  vi.stubGlobal('MediaStream', class {});
  vi.stubGlobal('AudioContext', class {
    sampleRate = 16000;
    destination = {};
    resume = async () => undefined;
    close = async () => undefined;
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  });
  vi.stubGlobal('caches', { open: async () => ({ keys: async () => [] }) });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('first recording without AI', () => {
  it('starts no download and saves no transcript', async () => {
    cfg = local;
    const { startTranscript, transcriptPatch, finishTranscript } = await import('./transcript');
    await startTranscript('r1', track);
    expect(workers).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(transcriptPatch('r1')).toEqual({ transcript: [], transcriptPending: false, transcriptDeferred: true });
    await finishTranscript('r1', 1000);
    expect(saves).toEqual([{ transcript: [], transcriptPending: false, transcriptDeferred: true }]);
    expect(workers).toHaveLength(0);
  });

  it('loads the model as before once the person has asked', async () => {
    cfg = { ...local, localAsked: true };
    const { startTranscript, cancelTranscript } = await import('./transcript');
    await startTranscript('r2', track);
    expect(workers).toHaveLength(1);
    cancelTranscript();
  });

  it('loads the model as before when it is already cached', async () => {
    cfg = local;
    vi.stubGlobal('caches', { open: async () => ({ keys: async () => [{ url: 'https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/main/x' }] }) });
    const { startTranscript, cancelTranscript } = await import('./transcript');
    await startTranscript('r3', track);
    expect(workers).toHaveLength(1);
    cancelTranscript();
  });
});
