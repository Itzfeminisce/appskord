// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaMissing, NotSaved, OldRecording, PreviewSlow } from './banners';
import { OpenElsewhere, UnsavedRecovered } from './dialogs';
import { LongRecording, OpeningSlow, OpeningSteps } from './opening';
import { NoProject, WindowSmall } from './pages';
import { EmptyTrack, NoClicks } from './tracks';
import { NoVoice, TranscriptFailed, WordsPending } from './transcript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function render(el: ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}

const noop = vi.fn();

// Every StatesOpen state with its copy, as the frame has it.
const STATES: [string, ReactElement, string[]][] = [
  ['opening-slow', <OpeningSlow onWait={noop} onLibrary={noop} />, ['Still getting this ready', 'Long recordings take a little longer the first time. Next time it opens straight away.', 'Keep waiting', 'Back to library']],
  ['old-recording', <OldRecording onDismiss={noop} />, ['Made with an older Klipkord', 'The camera is part of the screen video, so camera layouts and background blur are off. Everything else works.', 'Got it']],
  ['long-recording', <LongRecording duration={72 * 60_000} onOpen={noop} onLibrary={noop} />, ['This recording is 1 h 12 min', 'On this computer the preview may stutter after 60 minutes. Exports are not affected.', 'Open anyway', 'Back to library']],
  ['words-pending', <WordsPending progress={0.42} onGroq={noop} />, ['Words are on their way', 'Editing by text, clean up and captions turn on when the transcript is ready. You can cut on the timeline now. Transcribing · 42%', 'Use Groq instead']],
  ['transcript-failed', <TranscriptFailed stoppedAt={190_000} onRetry={noop} onGroq={noop} />, ["Couldn't make the transcript", 'The speech model stopped at 3:10. Your video is fine.', 'Try again', 'Use Groq instead']],
  ['no-voice', <NoVoice />, ['No talking found', 'This recording has no voice, so there is nothing to edit by text. Use the timeline to cut.']],
  ['no-clicks', <NoClicks onAddZoom={noop} />, ['No clicks recorded', "Window and screen recordings don't record clicks, so there are no auto zooms. Press Z to add one by hand.", 'Add a zoom']],
  ['media-missing', <MediaMissing name="intro-music.mp3" onFind={noop} onRemove={noop} />, ['A file is missing: intro-music.mp3', "It was removed from Klipkord's storage. The rest of the project is fine.", 'Find the file', 'Remove it']],
  ['open-elsewhere', <OpenElsewhere onEditHere={noop} onClose={noop} />, ['Open in another tab', 'This project is being edited in another tab. Edit here and that tab becomes read-only.', 'Edit here', 'Close']],
  ['unsaved-recovered', <UnsavedRecovered changes={12} minutes={3} onKeep={noop} onDiscard={noop} />, ['Your last edits were kept', 'Klipkord closed before saving. 12 changes from 3 min ago are back.', 'Keep them', 'Discard']],
  ['not-saved', <NotSaved onFreeUp={noop} onRetry={noop} />, ["Couldn't save your last change", 'Klipkord is out of storage on this computer. Your edits are kept in this tab until you free some space.', 'Free up space', 'Try again']],
  ['window-small', <WindowSmall width={1024} height={640} />, ['Make this window wider', 'The editor needs at least 1280 by 600. Yours is 1024 by 640.']],
  ['preview-slow', <PreviewSlow onLight={noop} onDismiss={noop} />, ['Preview is dropping frames', 'Turn on Light preview to keep it smooth. Exports are always full quality.', 'Light preview', 'Not now']],
  ['no-project', <NoProject onLibrary={noop} />, ['Pick a recording to edit', 'This tab was opened without a recording. Your recordings are in the library.', 'Open the library']],
  ['empty-track', <EmptyTrack onAdd={noop} />, ['Drop music here', 'Add music']],
];

describe('open states', () => {
  it.each(STATES)('%s shows the frame copy', (state, el, copy) => {
    const host = render(el);
    expect(host.querySelector(`[data-state="${state}"]`)).not.toBeNull();
    for (const line of copy) expect(host.textContent).toContain(line);
  });

  it('words-pending leaves the percent out until the transcriber reports one', () => {
    expect(render(<WordsPending />).textContent).toContain('You can cut on the timeline now.');
    expect(render(<WordsPending />).textContent).not.toContain('Transcribing');
  });

  it('EditorOpening steps tick off in order with their times', () => {
    const host = render(<OpeningSteps times={[800]} />);
    expect(host.textContent).toContain('Getting your recording ready');
    expect(host.textContent).toContain('Reading the video0.8 s');
    expect(host.textContent).toContain('Drawing the timeline');
    expect(host.textContent).toContain('Lining up words and clicks');
    expect(host.textContent).toContain('You can press Play as soon as the first frame shows.');
  });

  it('buttons call their handlers', () => {
    const onLight = vi.fn();
    const host = render(<PreviewSlow onLight={onLight} onDismiss={noop} />);
    act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Light preview')!.click());
    expect(onLight).toHaveBeenCalledOnce();
  });
});
