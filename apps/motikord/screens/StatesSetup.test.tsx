import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PRIVACY_ROWS } from './Privacy';
import StatesSetup from './StatesSetup';

describe('StatesSetup', () => {
  const html = renderToStaticMarkup(<StatesSetup />);
  it('renders every state with the frame copy', () => {
    for (const text of [
      'no-built-in-ai · Setup, Settings', 'Chrome’s built-in AI isn’t on this computer', 'The preview may be slow on this computer', 'Exports will take longer here',
      'Allow Motikord to reach Groq', 'Penv Cloud didn’t connect', 'No Groq key was shared with Motikord', 'Penv Cloud was disconnected',
      'Motikord doesn’t recognise this key', 'Groq didn’t accept this key', 'This is a Groq key · Checking…', 'pexels-key-rejected · Paste a key', 'Pexels didn’t accept this key', 'Media search still works with Openverse. Make a new Pexels key and paste it here.',
      'key-check-unreachable · PasteKey', 'Motikord can’t check your key right now', 'Your key is kept until Chrome closes, and Motikord will check it again as soon as it’s back.',
    ]) expect(html).toContain(text.replace(/’/g, '’'));
  });
  it('has the six privacy rows', () => {
    expect(PRIVACY_ROWS).toHaveLength(6);
  });
});
