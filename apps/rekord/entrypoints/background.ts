import { appSources, tabRefusedReply, type AppFlag } from '@/lib/capture';
import { resolveSources, type Sources } from '@/lib/sources';
import { getMeeting, pendingChunks, putMeeting } from '@/lib/db';
import { loadKeys } from '@/lib/penv';
import { onMessage, send, type MessageOf } from '@/lib/messages';
import { getSettings } from '@/lib/settings';
import { handleInstalled } from '@/lib/whatsNew';
import { BACKFILL_ALARM, BACKFILL_KEY, QUEUE_KEY, runBackfill } from '@/lib/memory/backfill';
import { rankOpenLoops } from '@/lib/memory/rank';
import { openLoops } from '@/lib/memory/store';
import {
  briefTabUrl, EVENTS_KEY, lookBackTabUrl, NOTE_BRIEF, NOTE_DUE, NOTE_LOOKBACK, NOTE_OWE, onReminderAlarm, scheduleReminders, setPanelRoute, snoozeFromNote,
  type PanelRoute,
} from '@/lib/reminders';
import { isStreamRequest, tokenReply } from '@/lib/transcribe/stream';
import { record as recordCall } from '@/lib/ledger';
import { goOff, goOn, OFF_RECORD_COMMAND, OFF_RECORD_WHAT } from '@/lib/live/offRecord';
import type { Meeting, RecordingState, TranscriberConfig } from '@/lib/types';
import type { OffscreenReply } from './offscreen/main';

/** Reply to `recording/start` and `recording/stop`. */
export type RecordingReply = { ok: true; meetingId?: string } | { ok: false; error: string };

const OFFSCREEN_PATH = '/offscreen.html';
const START_ERROR = "Rekord couldn’t start recording. Click the Rekord icon on your meeting tab, then try again.";

const STORE_KEY = 'rekord:recorder'; // storage.session survives service-worker restarts
type Persisted = { state: RecordingState; closeAfterDrain: string | null };

let state: RecordingState = { status: 'idle' };
/** Meeting whose transcription must finish before the offscreen document may close. */
let closeAfterDrain: string | null = null;
/** The in-flight start, so a Stop sent while starting takes effect once it finishes. */
let starting: Promise<RecordingReply> | null = null;
/** A meeting whose drain arrived while it was still stopping, before closeAfterDrain was set. */
let drainedWhileStopping: string | null = null;
/** Tail of the queue that runs offscreen create/close decisions one at a time; never rejects. */
let offscreenQueue: Promise<unknown> = Promise.resolve();

const ready = rehydrate();

async function rehydrate(): Promise<void> {
  try {
    const saved = (await browser.storage.session.get(STORE_KEY))[STORE_KEY] as Persisted | undefined;
    if (!saved) return;
    closeAfterDrain = saved.closeAfterDrain;
    // A start or stop cut short by the restart: 'starting' never reached the recorder; 'stopping' can be stopped again.
    if (saved.state.status === 'starting') state = { status: 'idle' };
    else if (saved.state.status === 'stopping') state = { ...saved.state, status: 'recording' };
    else state = saved.state;
  } catch (error) {
    console.error('Rekord: could not restore recording state', error);
  }
}

function persist(): void {
  const value: Persisted = { state, closeAfterDrain };
  browser.storage.session.set({ [STORE_KEY]: value }).catch((error) => console.error('Rekord: could not save recording state', error));
}

function setState(next: RecordingState): void {
  const statusChanged = next.status !== state.status;
  state = next;
  if (statusChanged) persist(); // level updates (~4/s) need not be stored
  void send({ type: 'recording/state', state });
}

function setCloseAfterDrain(meetingId: string | null): void {
  closeAfterDrain = meetingId;
  persist();
}

/** Badge colour from V4Notification. */
export const BADGE_COLOR = '#D92D20';

/** The toolbar badge: overdue promises, empty when none. */
export const badgeText = (overdue: number) => (overdue > 0 ? String(overdue) : '');

/** Sets the toolbar badge to the overdue count from Open loops. */
export async function refreshBadge(now = Date.now(), setText = (text: string) => browser.action.setBadgeText({ text })): Promise<string> {
  const text = badgeText(rankOpenLoops(await openLoops(now), now).overdue);
  await setText(text);
  return text;
}

function updateBadge(): void {
  refreshBadge().catch((error) => console.error('Rekord: could not update the badge', error));
}

export const BADGE_ALARM = 'rekord.badge';

function reschedule(): void {
  scheduleReminders().catch((error) => console.error('Rekord: could not schedule reminders', error));
}

/** The window the person last used, so a notification click can open the panel there. */
let lastWindowId: number | undefined;

/** Opens the side panel on a screen; rejects when Chrome refuses. Runs inside the notification click (a user gesture): nothing is awaited before open() when the window is known. */
function openPanelOn(screen: string, params: PanelRoute['params']): Promise<void> {
  const open = (windowId: number | undefined) =>
    windowId === undefined ? Promise.reject(new Error('No window to open the side panel in')) : browser.sidePanel.open({ windowId });
  const opening = lastWindowId !== undefined ? open(lastWindowId) : browser.windows.getLastFocused().then((w) => open(w.id));
  setPanelRoute(screen, params).catch((error) => console.error('Rekord: could not pass the screen to the side panel', error));
  return opening.catch((error) => {
    console.error('Rekord: could not open the side panel', error);
    throw error;
  });
}

function openTab(url: string): Promise<void> {
  return browser.tabs.create({ url }).then(() => undefined, (error) => {
    console.error('Rekord: could not open the tab', error);
    throw error;
  });
}

/** Notification click or button: brief, due-day Nudge (or Open) and Snooze, look back. The notification stays when nothing opened. */
function onNote(id: string, button?: number): void {
  const clear = () => void browser.notifications.clear(id).catch(() => undefined);
  const kept = () => undefined;
  if (id.startsWith(NOTE_BRIEF)) {
    const eventId = id.slice(NOTE_BRIEF.length);
    openPanelOn('brief', { eventId }).catch(() => openTab(briefTabUrl(eventId))).then(clear, kept);
  } else if (id.startsWith(NOTE_DUE)) {
    const itemId = id.slice(NOTE_DUE.length);
    if (button === 1) {
      snoozeFromNote(itemId).then(clear, (error) => console.error('Rekord: could not snooze the promise', error)).finally(updateBadge);
    } else {
      openPanelOn(button === 0 ? 'nudge' : 'promise', { itemId }).then(clear, kept);
    }
  } else if (id.startsWith(NOTE_OWE)) {
    const itemId = id.slice(NOTE_OWE.length);
    if (button === 1) {
      snoozeFromNote(itemId).then(clear, (error) => console.error('Rekord: could not snooze the promise', error)).finally(updateBadge);
    } else {
      openPanelOn('promise', { itemId }).then(clear, kept);
    }
  } else if (id.startsWith(NOTE_LOOKBACK)) {
    openTab(lookBackTabUrl(Number(id.slice(NOTE_LOOKBACK.length)) || undefined)).then(clear, kept);
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    handleInstalled(reason, browser.runtime.getManifest().version).catch((error) => console.error('Rekord: could not record the update', error));
  });
  browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch((error) => console.error('Rekord: could not colour the badge', error));
  // Each wake of the worker and each change the panel reports recounts overdue promises.
  updateBadge();
  // The engine saves items from this worker, so its progress writes are the cue; the daily alarm covers promises that turn overdue.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (BACKFILL_KEY in changes || QUEUE_KEY in changes)) updateBadge();
    // The panel refreshes the event cache while open; reminder settings change in Settings.
    if (area === 'local' && (EVENTS_KEY in changes || 'settings' in changes)) reschedule();
  });
  reschedule();
  // Seeds the window for a notification click that comes before any focus change.
  browser.windows.getLastFocused().then((w) => { lastWindowId ??= w.id; }, () => undefined);
  browser.windows.onFocusChanged.addListener((id) => {
    if (id !== browser.windows.WINDOW_ID_NONE) lastWindowId = id;
  });
  browser.notifications.onClicked.addListener((id) => onNote(id));
  browser.notifications.onButtonClicked.addListener((id, index) => onNote(id, index));
  browser.alarms.create(BADGE_ALARM, { periodInMinutes: 24 * 60 }).catch((error) => console.error('Rekord: could not schedule the badge update', error));
  // We open the panel ourselves from action.onClicked: with openPanelOnActionClick the click never reaches
  // the extension, so the meeting tab is not granted (activeTab) and tab capture is refused.
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.error('Rekord: could not set side panel behaviour', error));
  browser.action.onClicked.addListener((tab) => {
    // Must run synchronously inside the click (user gesture): no awaits before open().
    const opening = tab.id != null
      ? browser.sidePanel.open({ tabId: tab.id })
      : browser.sidePanel.open({ windowId: tab.windowId });
    opening.catch((error) => console.error('Rekord: could not open the side panel', error));
    // The click grants this tab (activeTab) but fires no tab event: tell an already-open panel to re-check.
    if (tab.id != null) void send({ type: 'tab/granted', tabId: tab.id });
  });

  // Memory backfill: started, resumed after a rate limit, or picked up after a restart by its alarm.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BACKFILL_ALARM) runBackfill().catch((error) => console.error('Rekord: could not build memory', error)).finally(updateBadge);
    if (alarm.name === BADGE_ALARM) updateBadge();
    onReminderAlarm(alarm.name).catch((error) => console.error('Rekord: could not send the reminder', error));
  });

  // After a browser restart, finish transcribing chunks left pending by an earlier meeting.
  browser.runtime.onStartup.addListener(() => void openForCatchUp());

  // Alt+Shift+O: off the record and back.
  browser.commands.onCommand.addListener((command) => {
    if (command !== OFF_RECORD_COMMAND) return;
    void ready.then(() => { if (state.status === 'recording') return setOffRecord(state.offRecord?.since === undefined); });
  });

  onMessage((msg) => {
    // v3 real time: a fresh short-lived Deepgram token per socket; the key itself never leaves the background.
    if (isStreamRequest(msg, 'stream/token')) return tokenReply(loadKeys);
    switch (msg.type) {
      case 'recording/get-state':
        return ready.then(() => state);
      case 'rekord.badge.refresh':
        updateBadge();
        return undefined;
      case 'recording/start':
        return ready.then(() => {
          if (state.status !== 'idle') return { ok: false, error: 'Rekord is already recording.' } as RecordingReply;
          // v3: an app start (`app: true`) records the shared screen audio instead of the tab.
          const app = appSources(msg as typeof msg & AppFlag);
          const run = startRecording(msg.tabId, app ?? resolveSources(msg.sources), app !== null);
          starting = run.finally(() => (starting = null));
          return run;
        });
      case 'recording/stop':
        return ready.then(stopRecording);
      case 'recording/off-record':
        return ready.then(() => setOffRecord(msg.on));
      case 'offscreen/levels':
        void ready.then(() => {
          if (state.status === 'recording') setState({ ...state, micLevel: msg.micLevel, tabLevel: msg.tabLevel });
        });
        return undefined;
      case 'transcriber/config':
        // The offscreen transcriber has no storage API; only the background answers this.
        return Promise.all([getSettings(), loadKeys()]).then(([settings, keys]): TranscriberConfig => ({ settings, keys }));
      case 'transcription/catch-up':
        // The offscreen transcriber handles it when open; otherwise open it so it resumes pending chunks.
        void openForCatchUp();
        return undefined;
      case 'transcription/drained':
        void ready.then(async () => {
          if (state.status !== 'idle') {
            // Record the drain so the doc can close once the current start/stop settles.
            if (msg.meetingId === closeAfterDrain) setCloseAfterDrain(null);
            else if (state.status === 'stopping' && state.meetingId === msg.meetingId) drainedWhileStopping = msg.meetingId;
            return;
          }
          // Close whenever nothing is recording, unless another meeting's drain is still pending.
          if (closeAfterDrain && closeAfterDrain !== msg.meetingId) return;
          setCloseAfterDrain(null);
          await closeOffscreen();
        });
        return undefined;
      default:
        return undefined;
    }
  });
});

async function startRecording(tabId: number, sources: Sources, app = false): Promise<RecordingReply> {
  const startedAt = Date.now();
  const meetingId = crypto.randomUUID();
  setState({ status: 'starting', meetingId, startedAt, micLevel: 0, tabLevel: 0 });

  let streamId = '';
  try {
    if (sources.tab && !app) streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (error) {
    console.error('Rekord: tab capture refused', error instanceof Error ? error.message : error);
    setState({ status: 'idle' });
    return tabRefusedReply();
  }

  let meeting: Meeting | undefined;
  let micUnavailable = false;
  try {
    const [tab, settings] = await Promise.all([
      app ? undefined : browser.tabs.get(tabId).catch(() => undefined),
      getSettings(),
    ]);
    meeting = {
      id: meetingId,
      title: tab?.title?.trim() || 'Untitled meeting',
      tabUrl: tab?.url,
      startedAt,
      status: 'recording',
      language: settings.language,
      ...(app && { source: 'app' as const }),
    };
    await putMeeting(meeting);
    await ensureOffscreen();
    const start: MessageOf<'offscreen/start'> & AppFlag = { type: 'offscreen/start', streamId, meetingId, startedAt, sources, ...(app && { app }) };
    const reply = await send<OffscreenReply>(start);
    if (!reply?.ok) throw new Error(reply?.error ?? START_ERROR);
    micUnavailable = reply.micUnavailable === true;
  } catch (error) {
    console.error('Rekord: recording failed to start', error);
    if (meeting) await putMeeting({ ...meeting, status: 'error', endedAt: Date.now() }).catch(() => undefined);
    setState({ status: 'idle' });
    // Never close a document still transcribing pending chunks; it closes itself once drained.
    await closeOffscreen(true);
    return { ok: false, error: error instanceof Error && error.message ? error.message : START_ERROR };
  }

  // In an app the shared screen audio is the meeting ("others"), shown on the meeting meter.
  setState({ status: 'recording', meetingId, startedAt, micLevel: 0, tabLevel: 0, sources: app ? { ...sources, tab: true } : sources, ...(micUnavailable && { micUnavailable }) });
  return { ok: true, meetingId };
}

/**
 * Off the record: the recorder switches first (stamped at the click); the state and ledger follow only once it says ok.
 * The ledger keeps one "nothing sent" row per span: its first and last times are when it began and ended.
 */
async function setOffRecord(on: boolean): Promise<{ ok: boolean }> {
  if (state.status !== 'recording' || (state.offRecord?.since !== undefined) === on) return { ok: state.status === 'recording' };
  const { meetingId, startedAt } = state;
  // The click: the recorder drops everything heard from here, and the span starts here too.
  const now = Date.now();
  const reply = await send<{ ok?: boolean }>({ type: 'offscreen/off-record', on, at: now });
  if (reply?.ok !== true) return { ok: false };
  if (state.status !== 'recording' || state.meetingId !== meetingId) return { ok: false };
  setState({ ...state, offRecord: on ? goOff(state.offRecord, now) : goOn(state.offRecord, now, startedAt) });
  persist();
  await recordCall({ meetingId, service: 'off-record', what: OFF_RECORD_WHAT, at: now, span: true })
    .catch((error) => console.error('Rekord: could not record off the record', error));
  return { ok: true };
}

async function stopRecording(): Promise<RecordingReply> {
  if (state.status === 'starting' && starting) await starting.catch(() => undefined); // stop as soon as start reaches 'recording' (or aborts)
  if (state.status !== 'recording') return { ok: true };
  const { meetingId, startedAt } = state;
  // An open span closes at the stop; the spans are kept on the meeting for the saved transcript.
  const offSpans = state.offRecord ? goOn(state.offRecord, Date.now(), startedAt).spans : [];
  if (state.offRecord?.since !== undefined) {
    await recordCall({ meetingId, service: 'off-record', what: OFF_RECORD_WHAT, span: true })
      .catch((error) => console.error('Rekord: could not record off the record', error));
  }
  setState({ ...state, status: 'stopping' });
  // Resolves after the last chunks (and the final continuous-recording part) are saved.
  const stopped = await send<OffscreenReply>({ type: 'offscreen/stop' });
  const meeting = await getMeeting(meetingId);
  // v2: a saved tab recording means speaker names can run after the meeting.
  // v3: a realtime meeting already has live speaker labels; the names step uses those.
  const realtime = stopped?.ok === true && stopped.realtime === true;
  const speakerStep = stopped?.ok && (stopped.recorded || realtime) ? ({ speakerStep: 'pending' } as const) : {};
  if (meeting) await putMeeting({ ...meeting, status: 'processing', endedAt: Date.now(), ...speakerStep, ...(realtime && { realtime: true }), ...(offSpans.length > 0 && { offSpans }) });
  if (drainedWhileStopping === meetingId) {
    drainedWhileStopping = null; // already drained: nothing left to wait for
  } else {
    setCloseAfterDrain(meetingId);
  }
  setState({ status: 'idle' });
  await closeOffscreen();
  return { ok: true, meetingId };
}

/**
 * Opens the offscreen document when chunks are pending and none is open; its transcriber resumes them on load
 * and reports `transcription/drained` ('*') once empty, which closes it again while idle.
 */
async function openForCatchUp(): Promise<void> {
  try {
    await ready;
    if (state.status !== 'idle') return; // the recording's document handles it
    if ((await pendingChunks()).length === 0) return;
    await ensureOffscreen(() => state.status === 'idle'); // a start that began meanwhile opens its own
  } catch (error) {
    console.error('Rekord: could not resume transcription', error);
  }
}

async function hasOffscreen(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

/** Runs one offscreen create/close decision after the previous one settles, so each sees the document's real state. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = offscreenQueue.then(task);
  offscreenQueue = run.catch(() => undefined);
  return run;
}

/** Creates the document unless one is open or `stillWanted()` turns false by the time this call's turn comes. */
function ensureOffscreen(stillWanted: () => boolean = () => true): Promise<void> {
  return serialized(async () => {
    if (!stillWanted() || (await hasOffscreen())) return;
    await browser.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'WEB_RTC'] as Browser.offscreen.Reason[],
      justification: 'Record meeting tab, app and microphone audio, and keep the meeting audible.',
    });
  });
}

/**
 * Closes the document if, at the moment of closing, nothing is recording or starting and no meeting still awaits
 * its drain. With `onlyIfNothingPending`, also keeps it open while any chunk awaits transcription.
 */
async function closeOffscreen(onlyIfNothingPending = false): Promise<void> {
  try {
    await serialized(async () => {
      if (onlyIfNothingPending && (await pendingChunks()).length > 0) return;
      if (!(await hasOffscreen())) return;
      // Re-checked after the last await, so a start or stop that began meanwhile keeps its document.
      if (state.status !== 'idle' || closeAfterDrain) return;
      await browser.offscreen.closeDocument();
    });
  } catch (error) {
    console.error('Rekord: could not close recorder', error);
  }
}
