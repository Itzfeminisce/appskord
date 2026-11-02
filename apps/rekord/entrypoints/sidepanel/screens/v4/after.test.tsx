// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { M, SAMPLE_AFTER, seedSample } from '@/lib/memory/sample';
import { getItem } from '@/lib/memory/store';
import type { IdentityApi } from '@/lib/google';
import { TASKS_SCOPE } from '@/lib/google';
import { mount, settle, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';
import { linearConnectDeps } from './LinearConnect';
import { sendTasksDeps, sendTasksSession } from './SendTasks';

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!;
const REDIRECT = 'https://fakeextensionid.chromiumapp.org/';
const identity = {
  launchWebAuthFlow: vi.fn(async (d: { url: string; interactive: boolean }) => {
    const q = new URL(d.url).searchParams;
    return `${REDIRECT}#${new URLSearchParams({ access_token: 'ya29.fake', expires_in: '3599', scope: q.get('scope')!, state: q.get('state')! })}`;
  }),
  getRedirectURL: () => REDIRECT,
} satisfies IdentityApi;

describe('after the meeting', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB(), 'after');
    world.now = () => SAMPLE_AFTER;
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(send);
    send.mockClear();
    identity.launchWebAuthFlow.mockClear();
  });

  it('follow-up: the AI draft, recipients from the invite and a Gmail compose link', async () => {
    await DEV_FRAMES.V4FollowUp!.setup!();
    const view = await mount(sidepanel, 'followUp', `/followUp?meeting=${M.sarah3}`);
    expect(view.host.querySelector('h1')?.textContent).toBe('Follow-up for 1:1 with Sarah');
    expect((view.host.querySelector('textarea') as HTMLTextAreaElement).value).toContain('Who owes what\n- Alex: Send the revised pricing deck, today');
    click(view.host.querySelector('[aria-label="Remove Tom Becker"]'));
    const href = view.host.querySelector('a.fu-gmail')!.getAttribute('href')!;
    expect(href.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=sarah%40northwind.co&su=Notes%20from')).toBe(true);
    expect(view.host.textContent).toContain('Gmail opens a new email with this text. Nothing is sent until you send it.');
  });

  it('send action items: your promises checked, the tasks scope asked on send, then the done state', async () => {
    await DEV_FRAMES.V4SendTasks!.setup!();
    const fetch = vi.fn(async (u: string | URL | Request) => new Response(JSON.stringify(String(u).includes('/lists/')
      ? { webViewLink: 'https://tasks.google.com/t' } : { items: [{ id: '@default', title: 'My Tasks' }] })));
    sendTasksDeps.current = { tasks: { identity, clientId: 'x', requestHosts: async () => true, fetch } };
    const view = await mount(sidepanel, 'sendTasks', `/sendTasks?meeting=${M.sarah3}`);
    await waitFor(() => expect(view.host.textContent).toContain('It can’t read your other tasks.'));
    expect(identity.launchWebAuthFlow).not.toHaveBeenCalled();
    click(await waitFor(() => button(view.host, 'Send 2 to Google Tasks') ?? false));
    await waitFor(() => expect(view.host.querySelector('.st-banner')?.textContent).toBe('2 tasks sent to My Tasks'));
    await waitFor(async () => expect((await getItem('n-deck'))?.sentTo?.[0]).toMatchObject({ service: 'gtasks', url: 'https://tasks.google.com/t' }));
    expect(new URL(identity.launchWebAuthFlow.mock.calls[0]![0].url).searchParams.get('scope')).toContain(TASKS_SCOPE);
    expect(view.host.querySelector('.st-banner')?.textContent).toBe('2 tasks sent to My Tasks');
    expect(view.host.textContent).toContain('Not sent · Owner: Sarah · due Fri 6 Nov');
    expect((await getItem('n-deck'))?.sentTo?.[0]).toMatchObject({ service: 'gtasks', url: 'https://tasks.google.com/t' });
    expect((await getItem('n-seats'))?.sentTo).toBeUndefined();
    expect(send).toHaveBeenCalledWith({ type: 'rekord.badge.refresh' });
    sendTasksDeps.current = undefined;
  });

  it('connect Linear shows the Penv Cloud status, never the key', async () => {
    await DEV_FRAMES.V4LinearConnect!.setup!();
    const view = await mount(sidepanel, 'linearConnect', '/linearConnect');
    expect(view.host.textContent).toContain('Found in Penv Cloud');
    expect(view.host.innerHTML).not.toContain('lin_api_test');
    expect((view.host.querySelector('select') as HTMLSelectElement).value).toBe('t-product');
  });

  it('connect Linear without Penv Cloud: one paste field, and Linear’s refusal under it', async () => {
    linearConnectDeps.current = {
      loadKeys: async () => ({}), penvKeys: async () => false, hasHosts: async () => true,
      record: async () => ({ id: '', service: 'linear' as const, what: '', count: 0, firstAt: 0, lastAt: 0 }),
      fetch: async () => new Response(JSON.stringify({ errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] }), { status: 400 }),
    };
    vi.spyOn(browser.permissions, 'request').mockImplementation(async () => true);
    const view = await mount(sidepanel, 'linearConnect', '/linearConnect');
    await waitFor(() => expect(view.host.querySelector('label[for="lc-key"]')?.textContent).toBe('Linear API key'));
    expect(view.host.textContent).not.toContain('from Penv Cloud');
    expect(view.host.textContent).toContain('Create one in Linear › Settings › Security & access');
    const input = view.host.querySelector('#lc-key') as HTMLInputElement;
    expect(input.placeholder).toBe('lin_api_…');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'lin_api_fake');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(button(view.host, 'Connect Linear'));
    await waitFor(() => expect(view.host.querySelector('#lc-key')?.getAttribute('aria-invalid')).toBe('true'));
    expect(view.host.querySelector('.lc-error')?.textContent).toBe('Linear didn’t accept this key. Check it’s a personal API key, or create a new one.');
    linearConnectDeps.current = undefined;
  });

  it('send action items to Linear: connected as you, your promises assigned to you', async () => {
    await DEV_FRAMES.V4SendTasksLinear!.setup!();
    const view = await mount(sidepanel, 'sendTasks', `/sendTasks?meeting=${M.sarah3}`);
    await waitFor(() => expect(view.host.querySelector('.st-account')?.textContent).toBe('Connected as alex@rekord-team.com' + 'Change'));
    expect(view.host.querySelector('.st-map')?.textContent).toBe('Your promisesAssign to meDueIssue due date');
    expect(button(view.host, 'Send 2 to Linear')).toBeTruthy();
    sendTasksDeps.current = undefined;
    sendTasksSession.tab = undefined;
  });

  it('send action items to Notion: the database and where owner and due land', async () => {
    await DEV_FRAMES.V4SendTasksNotion!.setup!();
    const view = await mount(sidepanel, 'sendTasks', `/sendTasks?meeting=${M.sarah3}`);
    await waitFor(() => expect(view.host.querySelector('.st-map')?.textContent).toBe('OwnerAssigneeDueDate'));
    expect(view.host.querySelector('.st-account')?.textContent).toContain('alex@rekord-team.com');
    expect((view.host.querySelector('#st-db') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Northwind tasks');
    expect(button(view.host, 'Send 2 to Notion')).toBeTruthy();
    sendTasksDeps.current = undefined;
    sendTasksSession.tab = undefined;
  });
});
