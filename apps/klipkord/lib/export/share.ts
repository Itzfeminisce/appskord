// ShareLink: v2's Drive flow (lib/drive.ts) for any finished export, into a "Klipkord" folder in the user's Drive.
import { DriveError, shareAnyone, stopSharing, uploadChunks, type DriveFile, type Fetch } from '../drive';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_FOLDER = 'Klipkord';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A 403 with the reason from Drive's error body: storageQuotaExceeded, userRateLimitExceeded, insufficientPermissions… */
export class DriveRefused extends DriveError {
  constructor(status: number, message: string, readonly reason: string, readonly said: string) { super(status, message); }
}

async function refusal(res: Response): Promise<{ reason: string; said: string }> {
  try {
    const body = (await res.clone().json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    return { reason: body.error?.errors?.[0]?.reason ?? '', said: body.error?.message ?? '' };
  } catch {
    return { reason: '', said: '' };
  }
}

async function ok(res: Response, what: string): Promise<Response> {
  if (res.status === 403) {
    const r = await refusal(res);
    throw new DriveRefused(403, `${what} failed with 403`, r.reason, r.said);
  }
  if (!res.ok) throw new DriveError(res.status, `${what} failed with ${res.status}`);
  return res;
}

/** The Klipkord folder; drive.file only lists folders Klipkord made, so a missing one is created. */
export async function driveFolder(fetchFn: Fetch, token: string): Promise<string> {
  const q = `name = '${DRIVE_FOLDER}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const found = await ok(await fetchFn(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: auth(token) }), 'Finding the folder');
  const id = ((await found.json()) as { files?: { id?: string }[] }).files?.[0]?.id;
  if (id) return id;
  const made = await ok(await fetchFn(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: FOLDER_MIME }),
  }), 'Making the folder');
  const body = (await made.json()) as { id?: string };
  if (!body.id) throw new Error('Drive returned no folder');
  return body.id;
}

/** Opens a resumable upload into `folder`; Drive answers with the session URL in Location. */
export async function startFolderUpload(fetchFn: Fetch, token: string, folder: string, meta: { name: string; mimeType: string; size: number }): Promise<string> {
  const res = await ok(await fetchFn(`${UPLOAD}?uploadType=resumable&fields=id,webViewLink`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': meta.mimeType, 'X-Upload-Content-Length': String(meta.size) },
    body: JSON.stringify({ name: meta.name, mimeType: meta.mimeType, parents: [folder] }),
  }), 'Starting the upload');
  const session = res.headers.get('Location');
  if (!session) throw new Error('Drive returned no upload session');
  return session;
}

export interface DriveShare { fileId: string; link: string; permissionId: string | null }

export interface ShareDeps { fetch: Fetch; sleep?: (ms: number) => Promise<void> }

/** Uploads one finished export and turns on "Anyone with the link". */
export async function shareExport(deps: ShareDeps, token: string, file: Blob, name: string, onProgress: (sent: number) => void, signal?: AbortSignal): Promise<DriveShare> {
  // lib/drive's errors carry only the status, so the last 403's body is kept to say why.
  let last: Response | null = null;
  const fetchFn: Fetch = async (...args) => {
    const res = await deps.fetch(...args);
    if (res.status === 403) last = res.clone();
    return res;
  };
  try {
    const folder = await driveFolder(fetchFn, token);
    const session = await startFolderUpload(fetchFn, token, folder, { name, mimeType: file.type || 'application/octet-stream', size: file.size });
    const uploaded: DriveFile = await uploadChunks({ ...deps, fetch: fetchFn }, token, session, file, onProgress, signal);
    const permissionId = await shareAnyone(fetchFn, token, uploaded.id);
    return { fileId: uploaded.id, link: uploaded.webViewLink, permissionId };
  } catch (error) {
    if (error instanceof DriveError && error.status === 403 && !(error instanceof DriveRefused) && last) {
      const r = await refusal(last);
      throw new DriveRefused(403, error.message, r.reason, r.said);
    }
    throw error;
  }
}

/** "Who can watch": Anyone with the link turns the permission on; Only people I add removes it. */
export async function setAnyone(fetchFn: Fetch, token: string, share: DriveShare, anyone: boolean): Promise<DriveShare> {
  if (anyone) return share.permissionId ? share : { ...share, permissionId: await shareAnyone(fetchFn, token, share.fileId) };
  if (share.permissionId) await stopSharing(fetchFn, token, share.fileId, share.permissionId);
  return { ...share, permissionId: null };
}

/** The reason Google gave, for drive-failed's "Google said: quota exceeded." */
export function googleSaid(error: unknown): string {
  if (error instanceof DriveRefused) {
    if (/storageQuota|quotaExceeded/i.test(error.reason)) return 'quota exceeded';
    if (/rateLimit|dailyLimit/i.test(error.reason)) return 'rate limit exceeded';
    if (/permission|forbidden|domainPolicy|notAuthorized/i.test(error.reason)) return 'permission denied';
    if (error.said) return error.said.replace(/\.$/, '').toLowerCase();
  }
  if (error instanceof DriveError && error.status === 401) return 'sign in again';
  const m = error instanceof Error ? error.message : String(error);
  return m.replace(/\.$/, '').toLowerCase();
}
