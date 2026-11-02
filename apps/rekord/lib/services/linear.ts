/** Linear over GraphQL with a personal API key: list teams and create issues. The key is sent only to api.linear.app. */
import { record as recordCall } from '../ledger';

export const LINEAR_KEY = 'LINEAR_API_KEY';
const API = 'https://api.linear.app/graphql';
export const LINEAR_KEYS_URL = 'https://linear.app/settings/account/security';
/** The team issues go to unless the user picks another when sending. */
export const LINEAR_TEAM_KEY = 'rekord.linear.team';

export type LinearErrorCode = 'auth' | 'offline' | 'rate-limited' | 'server';

const MESSAGES: Record<LinearErrorCode, string> = {
  auth: 'Linear didn’t accept that key. Check you copied all of it, then try again.',
  offline: 'Rekord couldn’t reach Linear. Check your connection and try again.',
  'rate-limited': 'Linear is busy right now. Try again in a moment.',
  server: 'Linear had a problem. Try again in a moment.',
};

export class LinearError extends Error {
  constructor(readonly code: LinearErrorCode, readonly status?: number) {
    super(MESSAGES[code]);
    this.name = 'LinearError';
  }
}

export interface LinearDeps { fetch?: typeof fetch; record?: typeof recordCall }
export interface LinearTeam { id: string; name: string }

async function gql<T>(key: string, query: string, variables: Record<string, unknown>, deps: LinearDeps): Promise<T> {
  let res: Response;
  try {
    // Personal API keys go in Authorization as they are, without "Bearer".
    res = await (deps.fetch ?? fetch)(API, { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new LinearError('offline');
  }
  if (res.status === 401 || res.status === 403) throw new LinearError('auth', res.status);
  if (res.status === 429) throw new LinearError('rate-limited', 429);
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { extensions?: { code?: string } }[] };
  const code = body.errors?.[0]?.extensions?.code;
  if (code === 'AUTHENTICATION_ERROR') throw new LinearError('auth', res.status);
  if (code === 'RATELIMITED') throw new LinearError('rate-limited', res.status);
  if (!res.ok || !body.data) throw new LinearError('server', res.status);
  return body.data;
}

/** The teams the key can see, in Linear's order. Also checks the key. */
export async function listTeams(key: string, deps: LinearDeps = {}, meetingId?: string): Promise<LinearTeam[]> {
  try {
    const data = await gql<{ teams?: { nodes?: LinearTeam[] } }>(key, 'query Teams { teams(first: 100) { nodes { id name } } }', {}, deps);
    return data.teams?.nodes ?? [];
  } finally {
    await (deps.record ?? recordCall)({ meetingId, service: 'linear', what: 'Team list' });
  }
}

const CREATE = `mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { url } } }`;

/** Creates one issue for a promise; resolves to its link. */
export async function createIssue(
  key: string, teamId: string, item: { text: string; due?: string; meetingId: string }, description: string, deps: LinearDeps = {},
): Promise<string> {
  try {
    const input = { teamId, title: item.text, description, ...(item.due ? { dueDate: item.due } : {}) };
    const data = await gql<{ issueCreate?: { success?: boolean; issue?: { url?: string } } }>(key, CREATE, { input }, deps);
    const url = data.issueCreate?.issue?.url;
    if (!data.issueCreate?.success || !url) throw new LinearError('server');
    return url;
  } finally {
    await (deps.record ?? recordCall)({ meetingId: item.meetingId, service: 'linear', what: 'Issues' });
  }
}

export async function savedTeam(): Promise<LinearTeam | undefined> {
  return (await browser.storage.local.get(LINEAR_TEAM_KEY))[LINEAR_TEAM_KEY] as LinearTeam | undefined;
}

export async function saveTeam(team: LinearTeam): Promise<void> {
  await browser.storage.local.set({ [LINEAR_TEAM_KEY]: { id: team.id, name: team.name } });
}
