import { useRouter } from '../entrypoints/sidepanel/router';
import { BackButton, Page } from './Setup';

/** One row per kind of data, from PLAN.md "Data and privacy". */
export const PRIVACY_ROWS: [string, string][] = [
  ['Clips, brand kit and library', 'Stay on this computer. They leave only inside a file you export.'],
  ['Your own media and fonts', 'Stay on this computer. Never sent to the AI or any library.'],
  ['Prompts and the clip’s text', 'Sent to Groq when you make or change a clip. Not sent when Chrome’s built-in AI writes your clips.'],
  ['Things you grab from a page', 'Their text goes to the AI only as part of a prompt you send.'],
  ['Media and music searches', 'Your search words go to the library you search. Files you add are downloaded once and kept here.'],
  ['Keys', 'Kept only until Chrome closes. Loaded from Penv Cloud or pasted by you. Never shown again.'],
];

export const CODE_URL = 'https://github.com/Itzfeminisce';

export default function Privacy() {
  const { back } = useRouter();
  return (
    <Page frame="Privacy">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '20px 24px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Where your data goes</h1>
      </div>
      <p style={{ margin: '12px 24px 0', fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Nothing leaves your computer unless you switch it on. There is no account, no analytics and no tracking.</p>
      <ul style={{ listStyle: 'none', margin: '16px 24px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {PRIVACY_ROWS.map(([what, where]) => (
          <li key={what} style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{what}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{where}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 'auto', padding: '20px 24px 24px', fontSize: 13, color: 'var(--muted)' }}>
        Motikord is open source. <a href={CODE_URL} target="_blank" rel="noreferrer">Read the code</a>
      </div>
    </Page>
  );
}
