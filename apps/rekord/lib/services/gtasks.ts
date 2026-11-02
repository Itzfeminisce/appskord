/** Google Tasks: the `tasks` scope is asked the first time the user sends, then lists are read and tasks added. */
import { getToken, googleFetch, grantedScopes, GoogleError, scopesFor, TASKS_SCOPE, type GoogleDeps } from '../google';
import { requestHosts, TASKS_HOSTS } from '../hosts';
import { record as recordCall } from '../ledger';
import { getSettings } from '../settings';
import type { MemoryItem } from '../memory/types';

const API = 'https://tasks.googleapis.com/tasks/v1';
/** Set once the user has turned Google Tasks on by sending to it. */
export const TASKS_ON_KEY = 'rekord.gtasks.on';
export const TASKS_APP_URL = 'https://tasks.google.com/';

export interface TaskList { id: string; title: string }
/** Google's default list, shown before Rekord may read the lists. */
export const DEFAULT_LIST: TaskList = { id: '@default', title: 'My Tasks' };

export interface TasksDeps extends GoogleDeps { record?: typeof recordCall }

export async function tasksTurnedOn(): Promise<boolean> {
  return (await browser.storage.local.get(TASKS_ON_KEY))[TASKS_ON_KEY] === true;
}

/**
 * Runs in the send click: Chrome's host prompt first (it needs the gesture), then Google's consent for `tasks`
 * alongside the parts already connected. Throws GoogleError('cancelled') when either is declined.
 */
export async function turnOnTasks(deps: TasksDeps = {}): Promise<void> {
  if (!(await (deps.requestHosts ?? requestHosts)(TASKS_HOSTS))) throw new GoogleError('cancelled');
  const { google } = await getSettings();
  await getToken(true, [...scopesFor(google), TASKS_SCOPE], deps);
  if (!(await grantedScopes()).includes(TASKS_SCOPE)) throw new GoogleError('cancelled');
  await browser.storage.local.set({ [TASKS_ON_KEY]: true });
}

/** The user's task lists, default first. Never asks Google interactively. */
export async function listTaskLists(deps: TasksDeps = {}, meetingId?: string): Promise<TaskList[]> {
  try {
    const res = await googleFetch(`${API}/users/@me/lists?maxResults=100`, [TASKS_SCOPE], deps);
    const body = (await res.json()) as { items?: { id?: string; title?: string }[] };
    const lists = (body.items ?? []).filter((l): l is TaskList => !!l.id && !!l.title);
    return lists.length ? lists : [DEFAULT_LIST];
  } finally {
    await (deps.record ?? recordCall)({ meetingId, service: 'google-tasks', what: 'Task lists' });
  }
}

/** Google wants an RFC 3339 time for `due` and keeps only its date. */
const dueTime = (due?: string) => (due ? `${due}T00:00:00.000Z` : undefined);

/** Adds one promise as a task; resolves to the task's link. */
export async function addTask(listId: string, item: Pick<MemoryItem, 'text' | 'due' | 'meetingId'>, notes: string, deps: TasksDeps = {}): Promise<string> {
  try {
    const res = await googleFetch(`${API}/lists/${encodeURIComponent(listId)}/tasks`, [TASKS_SCOPE], deps, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: item.text, notes, ...(item.due ? { due: dueTime(item.due) } : {}) }),
    });
    const task = (await res.json()) as { webViewLink?: string };
    return task.webViewLink || TASKS_APP_URL;
  } finally {
    await (deps.record ?? recordCall)({ meetingId: item.meetingId, service: 'google-tasks', what: 'Tasks' });
  }
}
