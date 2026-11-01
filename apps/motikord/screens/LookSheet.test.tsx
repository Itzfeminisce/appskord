import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { lookLine, paceHint } from './LookSheet';
import { move, stepMs, totalSeconds, wordCount } from './StoryboardEdit';
import { sceneList } from './Making';
import { packOf, templateLine } from './Templates';
import { TEMPLATES } from '../lib/templates';
import StatesCreate from './StatesCreate';
import { sidepanel } from '../entrypoints/sidepanel/router';

describe('v2 make screens', () => {
  it('words the look row and pace hint', () => {
    expect(lookLine({ style: 'auto', pace: 'normal', mood: 'upbeat' })).toBe('Auto style · Normal pace · Upbeat');
    expect(lookLine({ style: 'bold', pace: 'fast', mood: 'none' })).toBe('Bold style · Fast pace · No music');
    expect(paceHint('normal')).toBe('About 3 s a scene');
    expect(paceHint('calm')).toBe('About 4.5 s a scene');
  });
  it('edits beats', () => {
    expect(move([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(move([1, 2], 0, 5)).toEqual([1, 2]);
    expect(wordCount('  Fresh sourdough, baked here ')).toBe(4);
    expect(stepMs(1000, -1)).toBe(1000);
    expect(stepMs(3000, 1)).toBe(3500);
    expect(totalSeconds([{ template: 'hero', line: '', ms: 3000 }, { template: 'hero', line: '', ms: 4000 }])).toBe(7);
  });
  it('lists scenes from zero-based indexes', () => {
    expect(sceneList([0, 1, 3])).toBe('Scenes 1, 2 and 4');
    expect(sceneList([2])).toBe('Scene 3');
  });
  it('gives each template a pack and a line', () => {
    const t = TEMPLATES[0]!;
    expect(packOf(t)).toBeTruthy();
    expect(templateLine(t)).toMatch(/ · \d+ scenes? · \d+ s$/);
  });
  it('routes the new screens', () => {
    expect(sidepanel.names).toEqual(expect.arrayContaining(['LookSheet', 'StoryboardEdit', 'Making', 'Templates', 'SettingsModel']));
  });
  it('renders every v2 making state with the frame copy', () => {
    const html = renderToStaticMarkup(<StatesCreate />);
    for (const text of [
      "Couldn&#x27;t plan the story", "Groq&#x27;s reply didn&#x27;t make sense twice.", 'Try again', 'Make it simpler',
      'Scene 3 came back garbled. Asking again…', "can&#x27;t see images, so the visual check was skipped. The layout check still ran.", 'Change model',
      "Couldn&#x27;t reach Groq for the visual check. Your clip is ready without it.", '2 things still need a look', 'Open quality check',
      'Still working. Groq is slower than usual today.', 'Visual critic is off. The layout check still runs.',
    ]) expect(html).toContain(text);
  });
});
