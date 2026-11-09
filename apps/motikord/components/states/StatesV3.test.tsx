// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';
import { STATE_IDS, STATES, stateView, WHERE, type StateId } from './copy';
import { StateCard } from './StatesV3';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
afterEach(() => { for (const u of unmounts.splice(0)) u(); });

async function show(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(node); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}

// Verbatim from the StatesV3 frame: [id, where, title, line, action].
const FRAME: [StateId, string, string, string, string | undefined][] = [
  ['keyframe-failed', 'Check the key frames, scene 3', 'Scene 3’s key frame couldn’t be drawn', 'Your other key frames are kept. Try again to draw just this one.', 'Try again'],
  ['keyframes-waiting', 'Check the key frames', 'Drawing your key frames…', 'One still per scene in your look. Approve them, then Motikord adds the motion. No AI cost.', undefined],
  ['motion-failed', 'Making the motion', 'Adding motion stopped at scene 4', 'Your approved key frames are kept. Try again to carry on from scene 4.', 'Try again'],
  ['animate-layer-failed', 'Editor, Layer · Animate this layer', 'Groq didn’t answer', 'Your layer is unchanged. Try again to send the same words.', 'Try again'],
  ['animate-layer-unclear', 'Editor, Layer · Animate this layer', 'Motikord couldn’t turn those words into motion', 'Your layer is unchanged. Say what moves and how, like “words slide up one by one”.', 'Try other words'],
  ['captions-failed', 'Editor, Captions', 'Your narration couldn’t be written down', 'Your clip is fine and plays without captions. Try again to add them.', 'Try again'],
  ['captions-no-key', 'Editor, Captions', 'Auto captions need a Groq or OpenAI key', 'Only your narration goes to it, to be written down. Your clip works fine without captions.', 'Connect Penv Cloud'],
  ['captions-no-voice', 'Editor, Captions', 'No speech found in the narration', 'Your clip is unchanged. Captions appear once the narration has someone speaking.', 'Choose narration'],
  ['voiceover-failed', 'Editor, Voiceover', 'Your voiceover wasn’t made', 'Your script is kept as written. Try again to make the voice.', 'Try again'],
  ['voiceover-no-key', 'Editor, Voiceover', 'AI voiceover needs an OpenAI key', 'Only your script goes to OpenAI. Your clip works fine without a voice.', 'Add an OpenAI key'],
  ['restyle-failed', 'Restyle with v3 motion', 'Restyle didn’t finish', 'Your v2 clip is unchanged. Try again to restyle it with v3 motion.', 'Try again'],
  ['critic-not-available', 'Quality check', 'Your model can’t see images', 'The Story pass still ran. Pick a model that sees images to check the look and motion too.', 'Change model'],
  ['critic-fix-limit', 'Quality check, scene 2', 'Scene 2 still needs your eye', 'Motikord used its one automatic fix here. The scene stays as it is until you choose.', 'Show me'],
  ['critic-ai-failed', 'Quality check', 'The AI pass didn’t run', 'Groq didn’t answer. Your free checks still ran, so their notes are below. Try again to run the AI pass.', 'Try again'],
  ['preview-light', 'Editor, stage', 'Preview is lighter on this computer', 'Export renders every frame at full quality. A slower computer takes longer, never looks worse.', undefined],
  ['effect-heavy', 'Editor, Scene · Effects', 'This scene has many effects', 'Its preview drops to light so it plays smoothly. Export is always full quality.', undefined],
  ['three-d-unavailable', 'Editor, Layer · 3D', 'Chrome has 3D graphics turned off', '3D layers show flat in preview and export. Everything else is unchanged. Turn on “Use graphics acceleration when available” in Chrome to get depth back.', 'How to turn it on'],
  ['lottie-credit', 'Assets, after adding an animation', 'Credit added to Credits', 'This animation’s maker is named in your clip’s Credits. Nothing to do.', undefined],
  ['rig-photo', 'Editor, Layer · Rig', 'Photos can’t be rigged', 'Your photo stays as it is. Rigs work on shapes, so use a shape to give it bones.', 'Use a shape'],
  ['data-paste-failed', 'Editor, Scene · Chart data', 'Motikord couldn’t read the pasted table', 'Your chart keeps its numbers. Paste again with one label and one number per row.', 'Paste again'],
  ['look-guide-saved', 'Look guide, toast', 'Saved as a look guide', '“Morning shift” is ready for your next clip. Brand kit still wins on colours, fonts, logo.', undefined],
  ['export-60-fallback', 'Export', 'Exporting at 30 fps', '60 fps would take too long on this computer. Every frame is still full quality.', 'Export at 60 anyway'],
];

describe('StatesV3 ids', () => {
  it('wires every id the frame shows, and no other', () => {
    expect([...STATE_IDS].sort()).toEqual(FRAME.map((f) => f[0]).sort());
    expect(STATE_IDS).toHaveLength(22);
  });

  it.each(FRAME)('%s: where, title, line and action are the frame’s', async (id, where, title, line, action) => {
    expect(WHERE[id]).toBe(where);
    expect(STATES[id]).toMatchObject({ id, title, line, action });
    const onAction = vi.fn();
    const host = await show(<StateCard id={id} onAction={onAction} />);
    const card = host.querySelector(`[data-state="${id}"]`)!;
    expect(card.textContent).toContain(title);
    expect(card.textContent).toContain(line);
    const button = card.querySelector('button');
    if (!action) { expect(button).toBeNull(); return; }
    expect(button!.textContent).toBe(action);
    await act(async () => { button!.click(); });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('captions-no-key has a second button, Paste a key instead', async () => {
    const second = vi.fn();
    const host = await show(<StateCard id="captions-no-key" onAction2={second} />);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Connect Penv Cloud', 'Paste a key instead']);
    await act(async () => { buttons[1]!.click(); });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keyframes-waiting shows its count, the clip and the scene', async () => {
    const host = await show(<StateCard id="keyframes-waiting" />);
    const card = host.querySelector('[data-state=keyframes-waiting]')!;
    expect(card.getAttribute('aria-label')).toBe('Drawing your key frames, 1 of 4 ready');
    for (const t of ['1 of 4', 'Morning shift', 'Scene 1']) expect(card.textContent).toContain(t);
  });

  it('three-d-unavailable says what it opens', async () => {
    const host = await show(<StateCard id="three-d-unavailable" />);
    expect(host.textContent).toContain('Opens chrome://settings/system');
  });

  it('takes the scene number, the provider and the look guide’s name', () => {
    expect(stateView('keyframe-failed', { scene: 5 }).title).toBe('Scene 5’s key frame couldn’t be drawn');
    expect(stateView('motion-failed', { scene: 2 }).line).toBe('Your approved key frames are kept. Try again to carry on from scene 2.');
    expect(stateView('animate-layer-failed', { provider: 'OpenAI' }).title).toBe('OpenAI didn’t answer');
    expect(stateView('look-guide-saved', { name: 'Bold launch' }).line).toContain('“Bold launch” is ready');
  });

  it('failures are alerts and notices are statuses', async () => {
    const host = await show(<><StateCard id="captions-failed" /><StateCard id="preview-light" /></>);
    expect(host.querySelector('[data-state=captions-failed]')!.getAttribute('role')).toBe('alert');
    expect(host.querySelector('[data-state=preview-light]')!.getAttribute('role')).toBe('status');
  });

  it('the StatesV3 screen lists every id with where it shows', async () => {
    const { host } = await mount(sidepanel, 'StatesV3');
    for (const id of STATE_IDS) expect(host.textContent, id).toContain(`${id} · ${WHERE[id]}`);
    expect(host.querySelectorAll('[data-state]')).toHaveLength(22);
    expect(host.textContent).toContain('Every v3 error, wait and notice, as the user sees it.');
  });
});
