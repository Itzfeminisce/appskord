// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB, putMeeting, putSegment } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import type { Meeting } from '@/lib/types';
import { mount, waitFor } from '../../../test/mountRouter';
import { sidepanel } from '../App';

describe('saved transcript', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await updateSettings({ onboarded: true });
  });

  it('shows each off-the-record span as a marker in its place', async () => {
    const meeting: Meeting = { id: 'm-off', title: 'Roadmap', startedAt: 0, endedAt: 600_000, status: 'done', language: 'en', offSpans: [{ startMs: 60_000, endMs: 180_000 }] };
    await putMeeting(meeting);
    await putSegment({ id: 's1', meetingId: 'm-off', speaker: 'you', startMs: 30_000, endMs: 35_000, text: 'Before the break.', chunkId: 'c1' });
    await putSegment({ id: 's2', meetingId: 'm-off', speaker: 'you', startMs: 200_000, endMs: 205_000, text: 'Back on.', chunkId: 'c2' });
    const view = await mount(sidepanel, 'library');
    await act(async () => view.router.navigate('transcript', { meetingId: 'm-off' }));
    const list = await waitFor(() => {
      const el = view.host.querySelector('[aria-label="Transcript"]');
      expect(el?.textContent).toContain('Back on.');
      return el!;
    });
    const text = list.textContent!;
    expect(text).toContain('Off the record · 2 min');
    expect(text.indexOf('Before the break.')).toBeLessThan(text.indexOf('Off the record · 2 min'));
    expect(text.indexOf('Off the record · 2 min')).toBeLessThan(text.indexOf('Back on.'));
  });
});
