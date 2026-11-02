// Gmail compose only: Rekord opens a draft for the person to send. It never sends email itself.

export interface ComposeDraft { to?: string[]; subject: string; body: string }

/** Gmail's compose window, filled with the draft. */
export function composeUrl(draft: ComposeDraft): string {
  const params: [string, string][] = [['view', 'cm'], ['fs', '1']];
  const to = (draft.to ?? []).map((t) => t.trim()).filter(Boolean);
  if (to.length) params.push(['to', to.join(',')]);
  params.push(['su', draft.subject], ['body', draft.body]);
  return `https://mail.google.com/mail/?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
