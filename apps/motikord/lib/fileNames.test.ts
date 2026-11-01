import { describe, expect, it } from 'vitest';
import { slug, videoFileName, youllGet } from './fileNames';

describe('file names', () => {
  it('slugs clip names safely', () => {
    expect(slug('Sourdough promo')).toBe('sourdough-promo');
    expect(slug('  Café: “Big” sale!! ')).toBe('cafe-big-sale');
    expect(slug('///')).toBe('motikord-clip');
  });
  it('names each size and kind, see-through apart from WebM', () => {
    expect(videoFileName('Sourdough promo', '9:16', 'mp4')).toBe('sourdough-promo-9x16.mp4');
    expect(videoFileName('Sourdough promo', '16:9', 'webm-alpha')).toBe('sourdough-promo-16x9-see-through.webm');
    expect(videoFileName('Sourdough promo', '1:1', 'gif')).toBe('sourdough-promo-1x1.gif');
  });
  it("lists what you'll get, credits.txt last", () => {
    expect(youllGet('Sourdough promo', ['9:16'], ['mp4'], true)).toEqual(['sourdough-promo-9x16.mp4', 'credits.txt']);
    expect(youllGet('A', ['9:16', '1:1'], ['webm'], false)).toEqual(['a-9x16.webm', 'a-1x1.webm']);
  });
});
