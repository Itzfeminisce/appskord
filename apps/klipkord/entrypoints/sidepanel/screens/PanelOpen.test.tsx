// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, putRecording } from '@/lib/db';
import type { Recording } from '@/lib/types';
import { mount, settle } from '../../../test/mountRouter';
import { sidepanel } from '../App';
import { rowMeta, tracksLine } from './Saved';

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'rec-1', title: 'Invite your team', createdAt: Date.now(), duration: 402_000, status: 'ready', mode: 'tab', quality: '1080p',
  mime: 'video/webm', bytes: 1, markers: [], notes: [], comments: [], transcript: [], transcriptPending: false, edits: [], ...over,
});

const buttonNamed = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === name);

beforeEach(async () => {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
});

describe('PanelOpen: the side panel opens the editor', () => {
  it('names the separate tracks', () => {
    expect(tracksLine(['screen', 'camera', 'mic'])).toBe('Screen, camera and voice saved as separate tracks.');
    expect(tracksLine(['screen', 'mic', 'tab'])).toBe('Screen and voice saved as separate tracks.');
    expect(tracksLine(['screen'])).toBeNull();
  });

  it('library rows say how many cuts, and "camera baked in" before v3', () => {
    const v2 = rec({ createdAt: 0 });
    expect(rowMeta(v2, 1, 0)).toMatch(/· 6:42 · camera baked in$/);
    expect(rowMeta(rec({ v3: { sources: ['screen'], events: false } }), 3, Date.now())).toMatch(/· 6:42 · 3 cuts$/);
  });

  it('Saved for a v3 recording: Open in the editor opens the editor tab; Quick trim here keeps Trim', async () => {
    await putRecording(rec({ v3: { sources: ['screen', 'camera', 'mic'], events: false } }));
    const create = vi.spyOn(browser.tabs, 'create');
    const view = await mount(sidepanel, 'Home', '/Saved?recording=rec-1');
    const text = view.host.textContent ?? '';
    expect(text).toContain('Screen, camera and voice saved as separate tracks.');
    expect(text).toContain('The editor opens in a new tab. Recording stays here in the side panel.');
    await act(async () => buttonNamed(view.host, 'Open in the editor')[0]!.click());
    await settle();
    expect(create).toHaveBeenCalledWith({ url: browser.runtime.getURL('/editor.html#/rec-1') });
    expect(buttonNamed(view.host, 'Edit')).toHaveLength(1);
    await act(async () => buttonNamed(view.host, 'Quick trim here')[0]!.click());
    await settle();
    expect(view.router.route.screen).toBe('Trim');
  });

  it('Library rows get Edit and older ones say camera baked in', async () => {
    await putRecording(rec());
    const create = vi.spyOn(browser.tabs, 'create');
    const view = await mount(sidepanel, 'Home', '/Library');
    expect(view.host.textContent).toContain('camera baked in');
    await act(async () => buttonNamed(view.host, 'Edit')[0]!.click());
    await settle();
    expect(create).toHaveBeenCalledWith({ url: browser.runtime.getURL('/editor.html#/rec-1') });
  });
});
