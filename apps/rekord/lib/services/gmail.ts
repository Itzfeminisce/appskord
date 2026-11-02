/** Gmail compose links: Rekord opens a new email for the user to check and send. Rekord never sends email. */

export interface ComposeFields { to: string[]; subject: string; body: string }

/** The Gmail compose URL for a new email with these recipients, subject and body. */
export function composeUrl({ to, subject, body }: ComposeFields): string {
  // encodeURIComponent, not URLSearchParams: a '+' for a space would show up in the email.
  const q = [['view', 'cm'], ['fs', '1'], ['to', to.join(',')], ['su', subject], ['body', body]]
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return `https://mail.google.com/mail/?${q}`;
}
