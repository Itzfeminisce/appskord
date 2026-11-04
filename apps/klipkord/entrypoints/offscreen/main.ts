import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { cleanupStack, guard } from '@/lib/check/guard';
import { deleteRecording, getRecording, putRecording, updateRecording, type RecordingPatch } from '@/lib/db';
import { EVENTS_FILE, createEventsLog, type EventsBatch } from '@/lib/events';
import { fromRecording } from '@/lib/project/migrate';
import { flushProjects, putProject } from '@/lib/project/store';
import { onMessage, send, type MessageOf } from '@/lib/messages';
import { createMix, createSilenceWatch, type Mix } from '@/lib/mix';
import {
  CAMERA_BITRATE, IDLE, KEYFRAME_MS, VIDEO_BITRATE, chooseMime, chooseVoiceMime, clockElapsed, clockPause, clockResume, clockStart,
  containerOf, createChunkWriter, planTake, shortClock, takeSources, type EndReason, type RecorderState, type StartedPart, type TakePart,
} from '@/lib/recorder';
import { pickSource, type RecorderReply } from '@/lib/capture';
import { floatsBubble, type Bubble, type BubbleStatus } from '@/lib/bubble';
import { getSettings, updateSettings } from '@/lib/settings';
import { openFloatingBubble, type FloatingBubble } from './bubble';
import { createCompositor, type Compositor, type Ticker } from '@/lib/compositor';
import { freeBytes, shouldAutoStop } from '@/lib/storageMath';
import { videoStore } from '@/lib/videoStore';
import {
  cancelTranscript, currentStatus, finishTranscript, pauseTranscript, startTranscript, stopCapture, transcriptPatch, useGroq,
} from './transcript';

// The recorder tab owns every stream and recorder, so recording goes on with the side panel closed.
// It opens Chrome's picker itself: a picked stream id only works in the page that asked for it.

let state: RecorderState = IDLE;

function setState(patch: Partial<RecorderState>) {
  state = { ...state, ...patch };
  void send({ type: 'recorder/state', state });
  paint();
}

const live = document.getElementById('live')!;
const voice = document.getElementById('voice')!;
function paint() {
  const on = state.status === 'recording' || state.status === 'paused';
  live.hidden = !on;
  if (on) live.textContent = `Recording ${shortClock(clockElapsed(state.clock, Date.now()))}`;
  voice.hidden = !state.mic;
}
setInterval(paint, 1000);

// Read the window up front: sidePanel.open must run inside the click itself.
let windowId: number | undefined;
let tabId: number | undefined;
void chrome.tabs.getCurrent().then((tab) => { windowId = tab?.windowId; tabId = tab?.id; });
document.getElementById('back')!.addEventListener('click', () => {
  if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch((error) => console.error('Klipkord: could not open the side panel', error));
});

// The floating camera bubble (window or screen capture, "Floating on screen"). Chrome opens it only from a click here.
let wantBubble: Bubble | null = null;
let floating: FloatingBubble | null = null;
let opening = false;
const bubbleShow = document.getElementById('bubble-show')!;
const bubbleOn = document.getElementById('bubble-on')!;
const bubbleStatus = (): BubbleStatus => ({ wanted: Boolean(wantBubble), open: Boolean(floating), tabId, windowId });
function paintBubble() {
  bubbleShow.hidden = !wantBubble || Boolean(floating);
  bubbleOn.hidden = !wantBubble || !floating;
  void send({ type: 'bubble/status', status: bubbleStatus() });
}
function setFloating(bubble: Bubble | null) {
  wantBubble = bubble;
  if (!bubble && floating) {
    const open = floating;
    floating = null;
    open.close();
  }
  paintBubble();
}
document.getElementById('bubble-open')!.addEventListener('click', () => {
  if (!wantBubble || floating || opening) return;
  opening = true;
  openFloatingBubble(wantBubble.size, openCamera, {
    resized(size) {
      if (wantBubble) wantBubble = { ...wantBubble, size };
      updateSettings({ bubble: { size } }).catch((error) => console.error('Klipkord: could not save the bubble size', error));
    },
    closed() {
      floating = null;
      paintBubble();
    },
  })
    .then((opened) => {
      // The take ended while the camera was opening.
      if (opened && !wantBubble) return opened.close();
      floating = opened;
      paintBubble();
    })
    .catch((error) => console.error('Klipkord: could not open the camera bubble', error))
    .finally(() => { opening = false; });
});
document.getElementById('bubble-hide')!.addEventListener('click', () => floating?.close());

const stopTracks = (stream: MediaStream | null | undefined) => stream?.getTracks().forEach((t) => t.stop());

interface Streams {
  video: MediaStream;
  picture: MediaStreamTrack;        // what goes into the video's picture: the screen, or the screen with the bubble
  compositor: Compositor | null;
  mic: MediaStream | null;
  audio: MediaStreamTrack | null;   // what goes into the video's sound
  mix: Mix;
  cleanup: ReturnType<typeof cleanupStack>;
  bake: boolean;                    // "Bake camera into the video": v2's one file; off, each source its own file
  camera: MediaStream | null;       // separate camera (bake off)
  sound: MediaStreamTrack | null;   // tab or computer sound alone (bake off)
  size: { maxWidth: number; maxHeight: number };
  events: boolean;                  // the recorded tab's events script is in
}
let streams: Streams | null = null;

type Writer = ReturnType<typeof createChunkWriter>;
interface Part extends StartedPart { recorder: MediaRecorder; writer: Writer }
interface Take {
  id: string;
  parts: Part[];
  clockStart: number;               // wall time of the take's one start clock; every offset is measured from it
  events: ReturnType<typeof createEventsLog> | null;
  timers: ReturnType<typeof setInterval>[];
  discard: boolean;
}
let take: Take | null = null;

// One command at a time, so a shortcut and a click never interleave.
let queue: Promise<unknown> = Promise.resolve();
let inFlight = 0;
function run<T>(fn: () => Promise<T>): Promise<T> {
  inFlight++;
  const next = queue.then(fn).finally(() => {
    // The background skipped closing while this ran; tell it once nothing is left.
    if (--inFlight === 0 && !busy()) void send({ type: 'transcript/idle' });
  });
  queue = next.catch(() => undefined);
  return next;
}

// The background closes this document only when this says false.
const busy = () => Boolean(streams || take || inFlight || currentStatus()?.busy);

/** Waits for the last chunks to reach disk; past the limit the take keeps what was already committed. */
async function saveChunks(t: Take): Promise<boolean> {
  try {
    await guard(Promise.all(t.parts.map((p) => p.writer.flush())).then(() => videoStore.close(t.id)), {
      ms: FLUSH_MS, what: 'Saving the video',
    });
    return true;
  } catch (error) {
    console.error('Klipkord: could not save the last video chunks', error);
    return false;
  }
}
const FLUSH_MS = 30_000;

const ok: RecorderReply = { ok: true };
const fail = (error: string): RecorderReply => ({ ok: false, error });

async function openScreen(msg: MessageOf<'recorder/prepare'>, streamId: string, withSound: boolean): Promise<MediaStream> {
  const source = { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId };
  const video = { mandatory: { ...source, maxWidth: msg.maxWidth, maxHeight: msg.maxHeight, maxFrameRate: 30 } } as MediaTrackConstraints;
  const open = (audio: boolean) =>
    guard(navigator.mediaDevices.getUserMedia({ audio: audio ? ({ mandatory: source } as MediaTrackConstraints) : false, video }), {
      ms: 30_000,
      what: 'Screen capture',
      dispose: stopTracks,
    });
  if (!withSound) return open(false);
  try {
    return await open(true);
  } catch (error) {
    // A stream id is single-use only once it succeeds, so asking again without sound is safe.
    console.error('Klipkord: could not capture sound with the screen', error);
    return open(false);
  }
}

async function openMic(): Promise<MediaStream | null> {
  try {
    // Without a grant getUserMedia would wait out the guard for nothing.
    const state = await navigator.permissions.query({ name: 'microphone' as PermissionName }).then((s) => s.state, () => 'granted');
    if (state !== 'granted') return null;
    return await guard(
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      { ms: 15_000, what: 'Microphone', dispose: stopTracks },
    );
  } catch (error) {
    console.error('Klipkord: could not open the microphone', error);
    return null;
  }
}

// One worker clock for the compositor; each take starts and stops it.
const tick: Ticker = (fps, onTick) => {
  const worker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = onTick;
  worker.postMessage({ fps });
  return () => worker.terminate();
};

/** Null when the camera is busy, blocked or missing: the recording goes on without the bubble. */
async function openCamera(): Promise<MediaStream | null> {
  try {
    return await guard(navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } }), {
      ms: 15_000, what: 'Camera', dispose: stopTracks,
    });
  } catch (error) {
    console.error('Klipkord: could not open the camera', error);
    return null;
  }
}

/** The screen with the bubble drawn in, or the screen track itself when the camera is off or busy. */
async function openPicture(video: MediaStream, msg: MessageOf<'recorder/prepare'>, cleanup: ReturnType<typeof cleanupStack>) {
  const screenTrack = video.getVideoTracks()[0];
  if (!screenTrack) throw new Error('No video track');
  // A floating bubble is recorded as part of the screen, so nothing is drawn.
  if (floatsBubble(msg.mode, msg.bubble, msg.camera)) return { picture: screenTrack, compositor: null };
  const camera = msg.camera ? await openCamera() : null;
  if (!camera) return { picture: screenTrack, compositor: null };
  // Stops the camera track (light off) on every teardown path.
  cleanup.add(() => stopTracks(camera));
  try {
    const compositor = await guard(createCompositor(video, camera, msg.bubble, tick), { ms: 10_000, what: 'Compositor', dispose: (c) => c.stop() });
    cleanup.add(() => compositor.stop());
    return { picture: compositor.track, compositor };
  } catch (error) {
    console.error('Klipkord: could not start the camera bubble', error);
    stopTracks(camera);
    return { picture: screenTrack, compositor: null };
  }
}

/** Separate camera for a take that keeps each source apart; a floating bubble is already part of the screen. */
async function openSeparateCamera(msg: MessageOf<'recorder/prepare'>, cleanup: ReturnType<typeof cleanupStack>) {
  if (!msg.camera || floatsBubble(msg.mode, msg.bubble, msg.camera)) return null;
  const camera = await openCamera();
  cleanup.add(() => stopTracks(camera));
  return camera;
}

async function prepare(msg: MessageOf<'recorder/prepare'>): Promise<RecorderReply> {
  await teardown();
  const cleanup = cleanupStack();
  try {
    // Unreadable settings keep v2's tested path.
    const bake = await getSettings().then((s) => s.bakeCamera, (error) => {
      console.error('Klipkord: could not read settings', error);
      return true;
    });
    const picked = await pickSource(msg.mode, msg.sound);
    if (!picked) {
      setState(IDLE);
      return { ok: false, cancelled: true };
    }
    const video = await openScreen(msg, picked.streamId, msg.sound && picked.canRequestAudioTrack);
    cleanup.add(() => stopTracks(video));
    const mic = msg.mic ? await openMic() : null;
    cleanup.add(() => stopTracks(mic));
    const sound = video.getAudioTracks().length ? video : null;

    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    const mix = createMix(ctx, mic, sound);
    cleanup.add(() => void mix.close());
    // Without a running AudioContext the mix is silent; keep the voice rather than nothing.
    const direct = mic?.getAudioTracks()[0] ?? sound?.getAudioTracks()[0] ?? null;
    const audio = ctx.state === 'running' ? mix.track : direct;
    if (ctx.state !== 'running') console.error('Klipkord: could not start the sound mixer', ctx.state);
    cleanup.add(() => mix.track?.stop());

    const track = video.getVideoTracks()[0];
    if (!track) throw new Error('No video track');
    track.addEventListener('ended', () => void run(sharingEnded));
    const { picture, compositor } = bake ? await openPicture(video, msg, cleanup) : { picture: track, compositor: null };
    const camera = bake ? null : await openSeparateCamera(msg, cleanup);
    streams = {
      video, picture, compositor, mic, audio, mix, cleanup, bake, camera,
      sound: sound?.getAudioTracks()[0] ?? null, size: { maxWidth: msg.maxWidth, maxHeight: msg.maxHeight }, events: false,
    };
    setFloating(floatsBubble(msg.mode, msg.bubble, msg.camera) ? msg.bubble : null);
    setState({
      ...IDLE,
      status: 'armed', mode: msg.mode, quality: msg.quality,
      mic: Boolean(mic), micBlocked: msg.mic && !mic, sound: Boolean(sound),
    });
    return { ok: true, label: track.label, separate: !bake };
  } catch (error) {
    cleanup.run((e) => console.error('Klipkord: could not release capture', e));
    console.error('Klipkord: could not start capture', error);
    setState(IDLE);
    return fail(String(error));
  }
}

function recorderStopped(recorder: MediaRecorder | null): Promise<void> {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve();
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  // Waits for the last chunk, but never hangs if the recorder does not answer.
  return guard(stopped, { ms: 5000, what: 'MediaRecorder stop' }).catch((error) => console.error('Klipkord: could not stop the recorder', error));
}

/** The height really recorded (already capped to the screen by the capture constraints). */
function capturedHeight(picture: MediaStreamTrack, screen: MediaStream): number | undefined {
  const h = picture.getSettings().height ?? screen.getVideoTracks()[0]?.getSettings().height;
  return h ? Math.round(h) : undefined;
}

/** The tracks one file of the take records. */
function partTracks(part: TakePart, s: Streams): MediaStreamTrack[] {
  const mic = s.mic?.getAudioTracks()[0];
  const camera = s.camera?.getVideoTracks()[0];
  const screen = s.video.getVideoTracks()[0];
  const pick = {
    video: [s.picture, s.audio],
    voice: [mic],
    screen: [screen],
    camera: [camera],
    tab: [s.sound],
  }[part.file];
  return pick.filter((t): t is MediaStreamTrack => Boolean(t));
}

function partRecorder(part: TakePart, s: Streams, quality: keyof typeof VIDEO_BITRATE): { recorder: MediaRecorder; mime: string } {
  const supported = (t: string) => MediaRecorder.isTypeSupported(t);
  const stream = new MediaStream(partTracks(part, s));
  if (part.file === 'video') {
    const mime = chooseMime(supported, Boolean(s.audio));
    return { mime, recorder: new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE[quality] }) };
  }
  if (!part.video) {
    const mime = chooseVoiceMime(supported);
    return { mime, recorder: new MediaRecorder(stream, { mimeType: mime }) };
  }
  const mime = chooseMime(supported, false);
  // Chrome ignores the keyframe option where it does not support it.
  const options = {
    mimeType: mime, videoBitsPerSecond: part.file === 'camera' ? CAMERA_BITRATE : VIDEO_BITRATE[quality], videoKeyFrameIntervalDuration: KEYFRAME_MS,
  } as MediaRecorderOptions;
  return { mime, recorder: new MediaRecorder(stream, options) };
}

async function begin(): Promise<RecorderReply> {
  if (!streams || state.status !== 'armed') return fail('not armed');
  const s = streams;
  const id = crypto.randomUUID();
  const quality = state.quality ?? '1080p';
  const micTrack = s.mic?.getAudioTracks()[0];
  const onError = (error: unknown) => console.error('Klipkord: could not save a video chunk', error);
  const plan = planTake({ bake: s.bake, camera: Boolean(s.camera?.getVideoTracks()[0]), mic: Boolean(micTrack), sound: Boolean(s.sound) });

  await videoStore.open(id);
  const now = Date.now();
  const parts: Part[] = plan.map((part) => {
    const { recorder, mime } = partRecorder(part, s, quality);
    const writer = createChunkWriter((c) => videoStore.append(id, part.file, c), onError);
    const size = part.video ? partTracks(part, s)[0]?.getSettings() : undefined;
    return { ...part, recorder, writer, mime, startedAt: now, width: size?.width, height: size?.height };
  });
  const t: Take = { id, parts, clockStart: now, events: s.events && !s.bake ? createEventsLog() : null, timers: [], discard: false };
  for (const p of parts) {
    p.recorder.ondataavailable = (e) => !t.discard && p.writer.write(e.data);
    // Offsets on the one clock: each file starts when its recorder really started.
    p.recorder.addEventListener('start', () => { p.startedAt = Date.now(); }, { once: true });
  }
  const main = parts[0]!;
  const sources = parts.flatMap((p) => (p.kind ? [p.kind] : []));

  await putRecording({
    id, title: 'Untitled recording', createdAt: now, duration: 0, status: 'recording',
    mode: state.mode ?? 'tab', quality, height: capturedHeight(s.picture, s.video), mime: containerOf(main.mime), bytes: 0,
    markers: [], notes: [], comments: [], transcript: [], transcriptPending: false, transcriptModel: 'live', edits: [],
    ...(s.bake ? {} : { v3: { sources, events: false } }),
  });
  for (const p of parts) p.recorder.start(1000);
  take = t;
  t.events?.run(now, 0);
  setState({ status: 'recording', recordingId: id, clock: clockStart(now), silentMic: false, disk: undefined, endedBy: undefined });
  // The transcript listens to its own copy of the mic; the recorder never waits on it.
  void startTranscript(id, micTrack ?? null).catch((error) => console.error('Klipkord: could not start the transcript', error));

  const silence = createSilenceWatch();
  t.timers.push(
    setInterval(() => {
      if (state.status !== 'recording') return;
      const now = Date.now();
      void send({ type: 'recorder/tick', elapsed: clockElapsed(state.clock, now) });
      if (!streams?.mic) return;
      const silent = silence(streams.mix.micLevel(), now, state.muted);
      if (silent !== state.silentMic) setState({ silentMic: silent });
    }, 1000),
    setInterval(() => void persist(t), 5000),
    setInterval(() => void checkDisk(t), 10_000),
  );
  void checkDisk(t);
  return ok;
}

const takeBytes = (t: Take) => t.parts.reduce((sum, p) => sum + p.writer.bytes, 0);
const isV3 = (t: Take) => t.parts.some((p) => p.kind);

// Keeps duration and size current so a crash leaves a recording Recovered can offer back.
// Patches only what the recorder owns: duration, bytes, status and the transcript fields.
async function persist(t: Take, patch: RecordingPatch = {}) {
  const duration = patch.duration ?? clockElapsed(state.clock, Date.now());
  try {
    await updateRecording(t.id, { duration, bytes: takeBytes(t), ...transcriptPatch(t.id), ...patch });
    if (isV3(t)) await saveProject(t, duration, patch.status !== undefined);
  } catch (error) {
    console.error('Klipkord: could not update the recording', error);
  }
}

/** The v3 project keeps each source's offset and length, so a recovered take opens with its tracks lined up. */
async function saveProject(t: Take, duration: number, now = false) {
  const rec = await getRecording(t.id);
  if (!rec?.v3) return;
  const saved = putProject(fromRecording({ ...rec, duration }, takeSources(t.parts, t.clockStart, duration)));
  // A state change writes at once and does not wait, so the controls answer straight away.
  if (!now) return saved;
  void flushProjects();
  saved.catch((error) => console.error('Klipkord: could not save the project', error));
}

/** events.json next to the tracks; true once it is written. */
async function writeEvents(t: Take): Promise<boolean> {
  if (!t.events) return false;
  try {
    await videoStore.put(t.id, EVENTS_FILE, new Blob([JSON.stringify(t.events.track())], { type: 'application/json' }));
    return true;
  } catch (error) {
    console.error('Klipkord: could not save the events', error);
    return false;
  }
}

function addEvents(batch: EventsBatch) {
  take?.events?.add(batch);
}

/** Leaves the real cursor out of the screen where Chrome allows it; the editor draws a smooth one from the events. */
async function eventsOn(): Promise<RecorderReply> {
  if (!streams || streams.bake) return fail('not separate');
  streams.events = true;
  const screen = streams.video.getVideoTracks()[0];
  const cursor = (screen?.getCapabilities?.() as { cursor?: string[] } | undefined)?.cursor;
  if (!screen || !cursor?.includes('never')) return ok;
  const { maxWidth, maxHeight } = streams.size;
  try {
    await screen.applyConstraints({ cursor: 'never', width: { max: maxWidth }, height: { max: maxHeight }, frameRate: { max: 30 } } as MediaTrackConstraints);
  } catch (error) {
    console.error('Klipkord: could not hide the cursor', error);
  }
  return ok;
}

async function checkDisk(t: Take) {
  try {
    const free = freeBytes(await videoStore.usage());
    const seconds = clockElapsed(state.clock, Date.now()) / 1000;
    const bytesPerSecond = seconds > 2 ? takeBytes(t) / seconds : 0;
    setState({ disk: { free, bytesPerSecond } });
    if (shouldAutoStop(free) && take === t) void run(() => finish('disk-full'));
  } catch (error) {
    console.error('Klipkord: could not check free space', error);
  }
}

async function pauseTake(): Promise<RecorderReply> {
  if (!take || state.status !== 'recording') return fail('not recording');
  for (const p of take.parts) if (p.recorder.state === 'recording') p.recorder.pause();
  pauseTranscript(true);
  // Commits what is written so far; a crash while paused loses nothing.
  void videoStore.close(take.id).catch((error) => console.error('Klipkord: could not save the video', error));
  void writeEvents(take);
  const now = Date.now();
  take.events?.halt(now);
  setState({ status: 'paused', clock: clockPause(state.clock, now), silentMic: false });
  await persist(take, { status: 'paused' });
  return ok;
}

async function resumeTake(): Promise<RecorderReply> {
  if (!take || state.status !== 'paused') return fail('not paused');
  for (const p of take.parts) if (p.recorder.state === 'paused') p.recorder.resume();
  pauseTranscript(false);
  const now = Date.now();
  const clock = clockResume(state.clock, now);
  take.events?.run(now, clock.accumulated);
  setState({ status: 'recording', clock });
  await persist(take, { status: 'recording' });
  return ok;
}

async function finish(endedBy: EndReason): Promise<RecorderReply> {
  const t = take;
  if (!t || (state.status !== 'recording' && state.status !== 'paused')) return fail('not recording');
  const stoppedAt = Date.now();
  const clock = clockPause(state.clock, stoppedAt);
  t.events?.halt(stoppedAt);
  setState({ status: 'saving', clock });
  t.timers.forEach(clearInterval);
  pauseTranscript(true);
  await Promise.all(t.parts.map((p) => recorderStopped(p.recorder)));
  const saved = await saveChunks(t);
  const events = await writeEvents(t);
  take = null;
  stopCapture();
  const duration = clockElapsed(clock, Date.now());
  const v3 = isV3(t) ? { v3: { sources: t.parts.flatMap((p) => (p.kind ? [p.kind] : [])), events } } : {};
  await persist(t, { status: 'processing', duration, ...v3 });
  await teardown();
  setState({ status: 'done', recordingId: t.id, endedBy, silentMic: false });
  if (!saved) return fail('last chunks not saved in time');
  // Catch-up and the base pass run after the recorder is done; this document stays open until they finish.
  void finishTranscript(t.id, duration).catch((error) => console.error('Klipkord: could not finish the transcript', error));
  return ok;
}

/** Stops the take without keeping anything: its chunks, files and record are removed. */
async function dropTake() {
  const t = take;
  if (!t) return;
  t.discard = true;
  cancelTranscript();
  t.timers.forEach(clearInterval);
  take = null;
  await Promise.all(t.parts.map((p) => recorderStopped(p.recorder)));
  await guard(Promise.all(t.parts.map((p) => p.writer.flush())), { ms: FLUSH_MS, what: 'Stopping the writes' })
    .catch((error) => console.error('Klipkord: could not stop the video writes', error));
  await videoStore.remove(t.id).catch((error) => console.error('Klipkord: could not delete the video', error));
  await deleteRecording(t.id).catch((error) => console.error('Klipkord: could not delete the recording', error));
}

async function restart(): Promise<RecorderReply> {
  await dropTake();
  const live = streams?.video.getVideoTracks()[0]?.readyState === 'live';
  if (!live) {
    await teardown();
    setState(IDLE);
    return fail('sharing stopped');
  }
  setState({ status: 'armed', recordingId: undefined, clock: IDLE.clock, silentMic: false, disk: undefined, muted: false });
  streams?.mic?.getAudioTracks().forEach((t) => (t.enabled = true));
  return ok;
}

async function discard(): Promise<RecorderReply> {
  await dropTake();
  await teardown();
  setState(IDLE);
  return ok;
}

async function sharingEnded(): Promise<RecorderReply> {
  if (state.status === 'recording' || state.status === 'paused') return finish('sharing-stopped');
  if (state.status === 'armed') return discard();
  return ok;
}

async function setBubble(bubble: Bubble): Promise<RecorderReply> {
  streams?.compositor?.setBubble(bubble);
  if (wantBubble) {
    wantBubble = { ...wantBubble, size: bubble.size };
    floating?.setSize(bubble.size);
  }
  return ok;
}

async function mute(muted: boolean): Promise<RecorderReply> {
  streams?.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  setState({ muted, silentMic: false });
  return ok;
}

/** Stops every track (camera and mic lights off), the compositor and the mixer. */
async function teardown() {
  const s = streams;
  streams = null;
  if (wantBubble || floating) setFloating(null);
  s?.cleanup.run((error) => console.error('Klipkord: could not release capture', error));
}

onMessage((msg) => {
  switch (msg.type) {
    case 'recorder/prepare': return run(() => prepare(msg));
    case 'recorder/begin': return run(begin);
    case 'recorder/pause': return run(pauseTake);
    case 'recorder/resume': return run(resumeTake);
    case 'recorder/stop': return run(() => finish('user'));
    case 'recorder/cancel': return run(discard);
    case 'recorder/restart': return run(restart);
    case 'recorder/discard': return run(discard);
    case 'recorder/mute': return run(() => mute(msg.muted));
    case 'recorder/bubble': return setBubble(msg.bubble);
    case 'recorder/events-on': return run(eventsOn);
    case 'recorder/events': return addEvents(msg.batch);
    case 'bubble/get': return bubbleStatus();
    case 'transcript/get': return currentStatus() ?? { busy: false };
    case 'offscreen/busy': return busy();
    case 'transcript/use-groq': return useGroq().then(() => true);
    default: return undefined;
  }
});

addEventListener('pagehide', () => {
  take?.timers.forEach(clearInterval);
  if (take) void videoStore.close(take.id);
  void teardown();
});
