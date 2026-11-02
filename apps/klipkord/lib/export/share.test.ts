import { describe, expect, it, vi } from 'vitest';
import { DriveError } from '../drive';
import { DRIVE_FOLDER, driveFolder, googleSaid, setAnyone, shareExport } from './share';

const TOKEN = 'gtok_test';
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

describe('Drive share of a finished export', () => {
  it('finds the Klipkord folder or makes it', async () => {
    const found = vi.fn(async () => json({ files: [{ id: 'f1' }] }));
    expect(await driveFolder(found as unknown as typeof fetch, TOKEN)).toBe('f1');
    const q = decodeURIComponent(String((found.mock.calls[0] as unknown[])[0]));
    expect(q).toContain(`name = '${DRIVE_FOLDER}'`);
    expect(q).toContain("mimeType = 'application/vnd.google-apps.folder'");

    const calls: [string, RequestInit][] = [];
    const make = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push([url, init]);
      return calls.length === 1 ? json({ files: [] }) : json({ id: 'new' });
    });
    expect(await driveFolder(make as unknown as typeof fetch, TOKEN)).toBe('new');
    expect(calls[1]![1].method).toBe('POST');
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ name: 'Klipkord', mimeType: 'application/vnd.google-apps.folder' });
  });

  it('uploads into the folder in chunks, then turns on Anyone with the link', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      seen.push({ url, init });
      if (url.includes('/files?q=')) return json({ files: [{ id: 'folder1' }] });
      if (url.includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } });
      if (url === 'https://upload.test/session') return json({ id: 'file1', webViewLink: 'https://drive.google.com/file/d/file1/view' });
      if (url.includes('/permissions')) return json({ id: 'perm1' });
      return new Response(null, { status: 404 });
    });
    const progress: number[] = [];
    const file = new Blob([new Uint8Array(1000)], { type: 'video/mp4' });
    const share = await shareExport({ fetch: fetchFn as unknown as typeof fetch }, TOKEN, file, 'Invite your team.mp4', (n) => progress.push(n));
    expect(share).toEqual({ fileId: 'file1', link: 'https://drive.google.com/file/d/file1/view', permissionId: 'perm1' });
    const start = seen.find((s) => s.url.includes('uploadType=resumable'))!;
    expect(JSON.parse(String(start.init.body))).toEqual({ name: 'Invite your team.mp4', mimeType: 'video/mp4', parents: ['folder1'] });
    expect((start.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const put = seen.find((s) => s.url === 'https://upload.test/session')!;
    expect((put.init.headers as Record<string, string>)['Content-Range']).toBe('bytes 0-999/1000');
    const perm = seen.find((s) => s.url.includes('/permissions'))!;
    expect(JSON.parse(String(perm.init.body))).toMatchObject({ role: 'reader', type: 'anyone' });
    expect(progress.at(-1)).toBe(1000);
  });

  it('switches who can watch', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit = {}) => (init.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ id: 'perm2' })));
    const off = await setAnyone(fetchFn as unknown as typeof fetch, TOKEN, { fileId: 'f', link: 'l', permissionId: 'perm1' }, false);
    expect(off.permissionId).toBeNull();
    expect(String(fetchFn.mock.calls[0]![0])).toContain('/files/f/permissions/perm1');
    const on = await setAnyone(fetchFn as unknown as typeof fetch, TOKEN, off, true);
    expect(on.permissionId).toBe('perm2');
  });

  it("says what Google said", () => {
    expect(googleSaid(new DriveError(403, 'Uploading failed with 403'))).toBe('quota exceeded');
    expect(googleSaid(new DriveError(500, 'Uploading failed with 500'))).toBe('uploading failed with 500');
  });
});
