import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { connectGoogle, SCOPES, TASKS_SCOPE, type IdentityApi } from '../google';
import { TASKS_HOSTS } from '../hosts';
import { M, SAMPLE_AFTER, SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_ONE_ON_ONE, SAMPLE_ONE_ON_ONE_ITEMS, SAMPLE_PEOPLE } from '../memory/sample';
import type { MemoryItem } from '../memory/types';
import { DEFAULT_SETTINGS } from '../settings';
import { addDatabasePage, notionAccount, searchDatabases } from '../share/notion';
import { draftFollowUp, followUpFacts, plainDraft } from './followUp';
import { composeUrl } from './gmail';
import { addTask, listTaskLists, tasksTurnedOn, turnOnTasks } from './gtasks';
import { createIssue, LinearError, linearWorkspace, listTeams } from './linear';
import { sendable, sendItems } from './send';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const REDIRECT = 'https://fakeextensionid.chromiumapp.org/';
const record = vi.fn(async () => ({ id: '', service: 'groq' as const, what: '', count: 0, firstAt: 0, lastAt: 0 }));

function fakeIdentity() {
  return {
    launchWebAuthFlow: vi.fn(async (d: { url: string; interactive: boolean }) => {
      const q = new URL(d.url).searchParams;
      return `${REDIRECT}#${new URLSearchParams({ access_token: 'ya29.fake', expires_in: '3599', scope: q.get('scope')!, state: q.get('state')! })}`;
    }),
    getRedirectURL: vi.fn(() => REDIRECT),
  } satisfies IdentityApi;
}
const scopesAsked = (identity: ReturnType<typeof fakeIdentity>) =>
  identity.launchWebAuthFlow.mock.calls.map(([d]) => ({ interactive: d.interactive, scope: new URL(d.url).searchParams.get('scope')!.split(' ') }));

beforeEach(() => { fakeBrowser.reset(); record.mockClear(); });

describe('Gmail compose', () => {
  it('opens a new email with recipients, subject and body, spaces as %20', () => {
    const url = composeUrl({ to: ['sarah@northwind.co', 'tom@northwind.co'], subject: 'Notes from 1:1', body: 'Hi Sarah,\n\nThanks & bye' });
    expect(url).toBe('https://mail.google.com/mail/?view=cm&fs=1&to=sarah%40northwind.co%2Ctom%40northwind.co&su=Notes%20from%201%3A1&body=Hi%20Sarah%2C%0A%0AThanks%20%26%20bye');
  });
});

describe('follow-up email', () => {
  const meeting = { ...SAMPLE_ONE_ON_ONE, event: { ...SAMPLE_EVENT, attendees: [...SAMPLE_EVENT.attendees, { name: 'Tom Becker', email: 'tom@northwind.co' }] } };
  const facts = followUpFacts(meeting, SAMPLE_ONE_ON_ONE_ITEMS, SAMPLE_PEOPLE, { now: SAMPLE_AFTER, earlier: SAMPLE_ITEMS });

  it('takes recipients from the invite and writes the frame’s Full draft', () => {
    expect(facts.recipients.map((r) => r.email)).toEqual(['sarah@northwind.co', 'tom@northwind.co']);
    expect(facts.subject).toBe('Notes from 1:1 with Sarah, Tue 3 Nov');
    expect(plainDraft(facts, 'full')).toBe([
      'Hi Sarah and Tom,', '', 'Thanks for today.', '',
      'Decided', '- Northwind rollout starts 16 Nov (was 9 Nov).', '',
      'Who owes what',
      '- Alex: Send the revised pricing deck, today',
      '- Alex: Join Thursday’s rollout demo, Thu 5 Nov',
      '- Sarah: Northwind seat count, by Fri 6 Nov',
      '- Sarah: Intro to Northwind’s IT lead, no date yet', '',
      'Next meeting: Tue 10 Nov, 10:00.', '', 'Alex',
    ].join('\n'));
    expect(plainDraft(facts, 'short')).not.toContain('Decided');
  });

  it('asks the AI once, records it, and never records a call that did not leave', async () => {
    const config = { settings: DEFAULT_SETTINGS, keys: { GROQ_API_KEY: 'gsk_test' } };
    const fetch = vi.fn(async () => json({ choices: [{ message: { content: 'Hi Sarah and Tom,\n\nThanks!' } }] }));
    expect(await draftFollowUp(facts, 'short', { config, fetch, record })).toBe('Hi Sarah and Tom,\n\nThanks!');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'groq', what: 'Meeting notes for a follow-up email' });
    record.mockClear();
    await expect(draftFollowUp(facts, 'full', { config: { ...config, keys: {} }, fetch, record })).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('Google Tasks', () => {
  it('asks for the tasks scope only on turn-on, with the host first, then reads lists silently', async () => {
    const identity = fakeIdentity();
    const requestHosts = vi.fn(async () => true);
    const deps = { identity, clientId: 'x', requestHosts, record };
    await connectGoogle({ calendar: true, docs: false }, { identity, clientId: 'x', requestHosts, fetch: vi.fn(async () => json({})) });
    expect(scopesAsked(identity).flatMap((c) => c.scope)).not.toContain(TASKS_SCOPE);
    expect(await tasksTurnedOn()).toBe(false);

    await turnOnTasks(deps);
    expect(requestHosts).toHaveBeenLastCalledWith(TASKS_HOSTS);
    expect(scopesAsked(identity).at(-1)).toEqual({ interactive: true, scope: [SCOPES.calendar, TASKS_SCOPE] });
    expect(await tasksTurnedOn()).toBe(true);

    const fetch = vi.fn(async () => json({ items: [{ id: 'l1', title: 'My Tasks' }, { id: 'l2', title: 'Work' }] }));
    expect(await listTaskLists({ ...deps, fetch }, M.sarah3)).toEqual([{ id: 'l1', title: 'My Tasks' }, { id: 'l2', title: 'Work' }]);
    expect(identity.launchWebAuthFlow).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'google-tasks', what: 'Task lists' });
  });

  it('stays off when Chrome’s host prompt is declined', async () => {
    const identity = fakeIdentity();
    await expect(turnOnTasks({ identity, clientId: 'x', requestHosts: async () => false })).rejects.toMatchObject({ code: 'cancelled' });
    expect(identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(await tasksTurnedOn()).toBe(false);
  });

  it('adds a task with its due date and returns its link', async () => {
    const identity = fakeIdentity();
    await turnOnTasks({ identity, clientId: 'x', requestHosts: async () => true });
    const fetch = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json({ webViewLink: 'https://tasks.google.com/task/abc' }));
    const url = await addTask('l1', { text: 'Send the deck', due: '2026-11-03', meetingId: M.sarah3 }, 'Promised to Sarah Chen.', { identity, clientId: 'x', fetch, record });
    expect(url).toBe('https://tasks.google.com/task/abc');
    const [u, init] = fetch.mock.calls[0]!;
    expect(u).toBe('https://tasks.googleapis.com/tasks/v1/lists/l1/tasks');
    expect(JSON.parse(String(init!.body))).toEqual({ title: 'Send the deck', notes: 'Promised to Sarah Chen.', due: '2026-11-03T00:00:00.000Z' });
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'google-tasks', what: 'Tasks' });
  });
});

describe('ledger rows only for requests that left', () => {
  it('a task that never reached the network is not recorded', async () => {
    const identity = { launchWebAuthFlow: vi.fn(async () => { throw new Error('cancelled'); }), getRedirectURL: vi.fn(() => REDIRECT) } satisfies IdentityApi;
    const fetch = vi.fn(async () => json({}));
    await expect(addTask('l1', { text: 'x', meetingId: M.sarah3 }, 'n', { identity, clientId: 'x', fetch, record })).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('an issue is recorded after a network error, because the request was sent', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('offline'); });
    await expect(createIssue('k', 't1', { text: 'x', meetingId: M.sarah3 }, 'n', { fetch, record })).rejects.toBeInstanceOf(LinearError);
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('Linear', () => {
  it('lists teams and creates issues with the key as it is', async () => {
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { query: string };
      return body.query.includes('teams')
        ? json({ data: { teams: { nodes: [{ id: 't1', name: 'Product' }] } } })
        : json({ data: { issueCreate: { success: true, issue: { url: 'https://linear.app/x/issue/PRD-1' } } } });
    });
    expect(await listTeams('lin_api_test', { fetch, record })).toEqual([{ id: 't1', name: 'Product' }]);
    expect((fetch.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('lin_api_test');
    const url = await createIssue('lin_api_test', 't1', { text: 'Send the deck', due: '2026-11-03', meetingId: M.sarah3 }, 'note', { fetch, record });
    expect(url).toBe('https://linear.app/x/issue/PRD-1');
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body)).variables.input).toEqual({ teamId: 't1', title: 'Send the deck', description: 'note', dueDate: '2026-11-03' });
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'linear', what: 'Issues' });
  });

  it('reports a refused key', async () => {
    const fetch = vi.fn(async () => json({ errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 400));
    await expect(listTeams('lin_api_bad', { fetch, record })).rejects.toMatchObject({ code: 'auth' });
    await expect(listTeams('lin_api_bad', { fetch: vi.fn(async () => { throw new TypeError('offline'); }), record })).rejects.toBeInstanceOf(LinearError);
  });
});

describe('Assigning your own promises', () => {
  it('Linear: one call reads the teams and whose key it is; your promises go to you', async () => {
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { query: string };
      return body.query.includes('teams')
        ? json({ data: { viewer: { id: 'u-alex', email: 'alex@rekord-team.com' }, teams: { nodes: [{ id: 't1', name: 'Product' }] } } })
        : json({ data: { issueCreate: { success: true, issue: { url: 'https://linear.app/x/issue/PRD-1' } } } });
    });
    expect(await linearWorkspace('lin_api_test', { fetch, record })).toEqual({ teams: [{ id: 't1', name: 'Product' }], me: { id: 'u-alex', email: 'alex@rekord-team.com' } });
    const [mine, theirs] = [SAMPLE_ONE_ON_ONE_ITEMS.find((i) => i.id === 'n-deck')!, SAMPLE_ONE_ON_ONE_ITEMS.find((i) => i.id === 'n-seats')!];
    await sendItems({ service: 'linear', key: 'lin_api_test', teamId: 't1', me: 'u-alex' }, [mine, theirs], () => 'note', { linear: { fetch }, record, save: async () => undefined });
    const inputs = fetch.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init!.body)).variables.input);
    expect(inputs[0].assigneeId).toBe('u-alex');
    expect(inputs[1]).not.toHaveProperty('assigneeId');
  });

  it('Notion: the owner’s email and user, and the database’s people property', async () => {
    const fetch = vi.fn(async (u: string | URL | Request, _i?: RequestInit) => String(u).endsWith('/users/me')
      ? json({ bot: { workspace_name: 'Rekord team', owner: { type: 'user', user: { id: 'u-alex', person: { email: 'alex@rekord-team.com' } } } } })
      : String(u).endsWith('/search')
        ? json({ results: [{ id: 'db1', title: [{ plain_text: 'Northwind tasks' }], properties: { Name: { type: 'title' }, Assignee: { type: 'people' }, Date: { type: 'date' } } }] })
        : json({ id: 'p1', url: 'https://www.notion.so/p1' }));
    expect(await notionAccount('ntn_test', { fetch })).toEqual({ label: 'alex@rekord-team.com', userId: 'u-alex' });
    expect(await notionAccount('ntn_test', { fetch: vi.fn(async () => json({ bot: { workspace_name: 'Rekord team', owner: { type: 'workspace' } } })) })).toEqual({ label: 'Rekord team' });
    const [db] = await searchDatabases('ntn_test', { fetch });
    expect(db).toMatchObject({ dateProp: 'Date', peopleProp: 'Assignee' });
    await addDatabasePage('ntn_test', db!, { text: 'Send the deck', assigneeId: 'u-alex' }, '', { fetch });
    expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body)).properties.Assignee).toEqual({ people: [{ id: 'u-alex' }] });
  });
});

describe('Notion database pages', () => {
  it('finds databases with their title and date properties, and adds a page', async () => {
    const fetch = vi.fn(async (u: string | URL | Request, _i?: RequestInit) => String(u).endsWith('/search')
      ? json({ results: [{ id: 'db1', title: [{ plain_text: 'Tasks' }], properties: { Name: { type: 'title' }, Due: { type: 'date' } } }] })
      : json({ id: 'p1', url: 'https://www.notion.so/p1' }));
    const [db] = await searchDatabases('ntn_test', { fetch });
    expect(db).toEqual({ id: 'db1', title: 'Tasks', titleProp: 'Name', dateProp: 'Due' });
    expect(await addDatabasePage('ntn_test', db!, { text: 'Send the deck', due: '2026-11-03' }, 'note', { fetch })).toBe('https://www.notion.so/p1');
    const body = JSON.parse(String(fetch.mock.calls[1]![1]!.body));
    expect(body.parent).toEqual({ database_id: 'db1' });
    expect(body.properties.Due).toEqual({ date: { start: '2026-11-03' } });
  });
});

describe('sending', () => {
  const items = sendable(SAMPLE_ONE_ON_ONE_ITEMS, M.sarah3);
  it('lists the meeting’s promises, yours first, without left-out ones', () => {
    expect(items.map((i) => i.id)).toEqual(['n-deck', 'n-demo', 'n-seats', 'n-intro']);
  });

  it('marks each sent promise and stops at the first failure', async () => {
    const saved: MemoryItem[] = [];
    let n = 0;
    const fetch = vi.fn(async () => (++n === 2 ? json({}, 500) : json({ id: `p${n}`, url: `https://www.notion.so/p${n}` })));
    const database = { id: 'db1', title: 'Tasks', titleProp: 'Name' };
    const result = await sendItems({ service: 'notion', token: 'ntn_test', database }, items.slice(0, 3), () => 'note',
      { notion: { fetch }, record, now: () => 42, save: async (i) => { saved.push(i); } });
    expect(result.sent.map((s) => s.item.id)).toEqual(['n-deck']);
    expect(saved[0]!.sentTo).toEqual([{ service: 'notion', url: 'https://www.notion.so/p1', at: 42 }]);
    expect(result.error).toBeDefined();
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'notion', what: 'Action items' });
  });
});
