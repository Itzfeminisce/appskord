/** Frame SettingsPrivacy: PLAN "Data and privacy" as the frame words it. */
const REPO_URL = 'https://github.com/Itzfeminisce/appskord';

const ROWS: [string, string, string][] = [
  ['Boards, cards, notes', 'This computer', 'Nothing. Only inside a file you export.'],
  ['Images and files', 'This computer', 'Nothing. Only inside a file you export. Never sent to AI.'],
  ['Saved pages', 'This computer: title, address, preview and page text, taken when you save', 'Nothing at save time. Briefkord reads the page again only when you press Refresh.'],
  ['Text for AI', 'This computer', 'When you press an AI action, only the text it needs goes to the provider you picked.'],
  ['Exported files', 'The folder you choose', 'Wherever you send them. Briefkord never uploads them.'],
  ['Keys', 'This browser session, cleared when Chrome closes', 'Fetched from Penv Cloud or pasted by you. Never shown, logged or put in a file.'],
];

export function Privacy() {
  return (
    <main className="st-main">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 className="st-h2">Where your data goes</h2>
        <p className="st-lead">Nothing leaves this computer unless you send it. No account, no server, no analytics, no tracking.</p>
      </div>
      <table className="st-table st-privacy">
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">Where it stays</th>
            <th scope="col">What can leave, and when</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([what, where, leaves]) => (
            <tr key={what}>
              <td>{what}</td>
              <td>{where}</td>
              <td>{leaves}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="st-note">
        Briefkord is open source.{' '}
        <a className="st-link" href={REPO_URL} target="_blank" rel="noreferrer">
          Read the code
        </a>
      </span>
    </main>
  );
}
