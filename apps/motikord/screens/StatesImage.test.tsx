import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiImagesOff, ImageKeyMissing, ImageKeyRejected, ImageMaking, ImageOffline, ImageQuota, ImageRefused } from './StatesMedia';

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");

describe('AI image states copy', () => {
  it('uses the frame words', () => {
    expect(html(<ImageKeyMissing />)).toContain('Add an image key to make images');
    expect(html(<ImageKeyMissing />)).toContain('Connect Penv Cloud');
    expect(html(<ImageKeyRejected />)).toContain('OpenAI refused the image key');
    expect(html(<ImageMaking />)).toContain('Making…');
    expect(html(<ImageRefused />)).toContain("OpenAI didn't make this image. Try different words.");
    expect(html(<ImageQuota />)).toContain('Search free media');
    expect(html(<ImageOffline />)).toContain("Couldn't reach OpenAI. Check your connection.");
    expect(html(<AiImagesOff />)).toContain('Open Settings');
  });
});
