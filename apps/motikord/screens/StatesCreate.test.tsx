import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiFooter, GroqBusy, MediaUnsupported, VideoWontPlay } from './StatesCreate';
import StatesCreate from './StatesCreate';

describe('StatesCreate', () => {
  const html = renderToStaticMarkup(<StatesCreate />);
  it('renders every state with the frame copy', () => {
    for (const text of [
      'prompt-empty · Make a clip', 'Describe your clip, like “a 10-second promo for my podcast”', 'Describe your clip, grab something from a page, or add your media.',
      'Motikord couldn’t make this clip', 'The AI’s answer didn’t work, even on a second try. Your prompt is kept. Try again, or start from a template.', 'See templates',
      'Groq is busy right now', 'Motikord will try again in 20 seconds.', 'Try now',
      'Groq isn’t responding', 'Open Settings', 'Penv Cloud was disconnected', 'You’re offline',
      'Clips can be up to 60 seconds', 'Motikord made a 60-second clip. For a longer idea, make two clips.', 'Allow Motikord to reach Groq',
      'Motikord can’t use “brochure.pdf”', 'Add images, videos, music or font files. The others were added.',
      'Chrome can’t play “drone-shot.mov”', 'Save it as MP4 or WebM and add it again.',
      'Only your prompt went to Groq. Your media stayed here.', 'Written on this computer by Chrome’s built-in AI. Nothing was sent.',
    ]) expect(html).toContain(text);
  });
  it('names the file and the wait', () => {
    expect(renderToStaticMarkup(<MediaUnsupported name="a.doc" />)).toContain('can’t use “a.doc”');
    expect(renderToStaticMarkup(<VideoWontPlay name="b.mov" />)).toContain('can’t play “b.mov”');
    expect(renderToStaticMarkup(<GroqBusy seconds={5} />)).toContain('in 5 seconds');
  });
  it('words the footer for each AI', () => {
    expect(renderToStaticMarkup(<AiFooter ai="cloud" />)).toContain('Groq');
    expect(renderToStaticMarkup(<AiFooter ai="local" />)).toContain('Nothing was sent');
  });
});
