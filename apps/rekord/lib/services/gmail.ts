// Gmail compose only: Rekord opens a draft for the person to send. It never sends email itself.

export interface ComposeDraft { to?: string[]; subject: string; body: string }
export type ComposeFields = ComposeDraft;

/** Longest compose link Gmail reliably opens. */
export const MAX_COMPOSE_URL = 7500;

/** True when the draft's body is too long for a link; the compose window then opens without it. */
export const bodyTooLong = (draft: ComposeDraft): boolean => composeUrl(draft, true).length > MAX_COMPOSE_URL;

/** Gmail's compose window, filled with the draft; over the cap the body is left out. */
export function composeUrl(draft: ComposeDraft, full = false): string {
  const params: [string, string][] = [['view', 'cm'], ['fs', '1']];
  const to = (draft.to ?? []).map((t) => t.trim()).filter(Boolean);
  if (to.length) params.push(['to', to.join(',')]);
  params.push(['su', draft.subject]);
  const withBody: [string, string][] = [...params, ['body', draft.body]];
  const url = (p: [string, string][]) => `https://mail.google.com/mail/?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  if (full || url(withBody).length <= MAX_COMPOSE_URL) return url(withBody);
  return url(params);
}
