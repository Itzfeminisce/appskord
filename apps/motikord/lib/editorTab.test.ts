import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findEditorTab } from './editorTab';

const EDITOR = 'chrome-extension://abc/editor.html';
const tab = (tabId: number, documentUrl: string) => ({ tabId, windowId: 1, documentUrl });

describe('findEditorTab', () => {
  beforeEach(() => vi.stubGlobal('chrome', { runtime: { ContextType: { TAB: 'TAB' } } }));
  afterEach(() => vi.unstubAllGlobals());

  const contexts = [
    tab(1, 'chrome-extension://abc/sidepanel.html#/Home'),
    tab(2, `${EDITOR}?clip=c1#/Editor?clip=c1`),
    tab(3, `${EDITOR}#/Editor?clip=c2`),
    tab(4, EDITOR),
  ];
  const fake = vi.fn(async () => contexts);

  it('asks only for tab contexts', async () => {
    await findEditorTab(fake, EDITOR, 'c1');
    expect(fake).toHaveBeenCalledWith({ contextTypes: ['TAB'] });
  });

  it('finds the clip in the query once the hash route is added', async () => {
    expect((await findEditorTab(fake, EDITOR, 'c1'))?.tabId).toBe(2);
  });

  it('finds the clip in the hash route search', async () => {
    expect((await findEditorTab(fake, EDITOR, 'c2'))?.tabId).toBe(3);
  });

  it('matches an editor with no clip only when none is asked for', async () => {
    expect((await findEditorTab(fake, EDITOR))?.tabId).toBe(4);
    expect(await findEditorTab(fake, EDITOR, 'c9')).toBeUndefined();
  });
});
