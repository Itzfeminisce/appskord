import { useEffect, useState } from 'react';
import { listMeetings } from '@/lib/db';
import { allowFolder, chooseFolder, folderStatus, meetingPath, personPath, stopFolder, writeAll, DECISIONS_PATH, OPEN_LOOPS_PATH, type FolderStatus } from '@/lib/folder';
import { listPeople } from '@/lib/memory/store';
import { BackIcon } from '../../components/v4/icons';
import { useRouter } from '../../router';
import './settings.css';

/** Dev frames: the frame's two states stacked, with a sample status, so no real folder is needed. */
export const folderDev: { board?: { label: string; on: FolderStatus } } = {};

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const FolderIcon = ({ stroke = 'currentColor' }: { stroke?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
);

/** The preview tree from real data: the latest meeting and someone in it (else the person met most). */
function useTree(): string[] {
  const [tree, setTree] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([listMeetings(), listPeople()])
      .then(([meetings, people]) => {
        const latest = [...meetings].sort((a, b) => b.startedAt - a.startedAt)[0];
        const emails = new Set(latest?.event?.attendees.filter((a) => !a.self).map((a) => a.email) ?? []);
        const person = people.find((p) => (p.email && emails.has(p.email)) || (latest && p.meetingIds.includes(latest.id)))
          ?? [...people].sort((a, b) => b.meetingIds.length - a.meetingIds.length)[0];
        setTree([latest && meetingPath(latest), person && personPath(person), OPEN_LOOPS_PATH, DECISIONS_PATH]
          .filter((p): p is string => !!p).map((p) => `Rekord/${p}`));
      })
      .catch((error) => console.error('Rekord: could not load your meetings', error));
  }, []);
  return tree;
}

function Header() {
  const { back, canGoBack, replace } = useRouter();
  return (
    <header className="sm-head">
      <button type="button" className="v4-icon" aria-label="Back" onClick={() => (canGoBack ? back() : replace('settingsMemory'))}><BackIcon /></button>
      <h1>Rekord folder</h1>
    </header>
  );
}

const Tree = ({ tree }: { tree: string[] }) => <ul className="fo-tree">{tree.map((p) => <li key={p}>{p}</li>)}</ul>;

function Off({ tree, choose }: { tree: string[]; choose: () => void }) {
  return (
    <div className="fo-body">
      <div className="fo-card">
        <p className="fo-what">Every meeting and your memory as plain Markdown files, so Obsidian, Claude or any AI can read them without Rekord.</p>
        <div className="fo-preview"><span>What it will look like</span><Tree tree={tree} /></div>
        <button type="button" className="sm-btn fo-choose" onClick={choose}><FolderIcon stroke="#FFFFFF" />Choose a folder</button>
        <span className="fo-off">Off for now. Rekord writes nothing until you choose.</span>
      </div>
    </div>
  );
}

interface OnProps { status: Exclude<FolderStatus, { state: 'off' }>; tree: string[]; allow: () => void; all: () => void; change: () => void; stop: () => void; busy: boolean }

function On({ status, tree, allow, all, change, stop, busy }: OnProps) {
  return (
    <div className="fo-body fo-body-on">
      {status.state === 'needsPermission' && (
        <div role="alert" className="fo-alert">
          <div className="fo-alert-line">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></svg>
            <span>Chrome needs your OK to keep writing to Rekord folder.</span>
          </div>
          <button type="button" className="sm-btn" onClick={allow}>Allow</button>
        </div>
      )}
      <div className="fo-card">
        <div className="fo-where">
          <span className="fo-icon"><FolderIcon /></span>
          <span className="fo-where-text">
            <span className="fo-path">{status.name}</span>
            {status.lastWrittenAt !== undefined && <span className="fo-status">Writing here · Last written <span className="fo-mono">{time(status.lastWrittenAt)}</span></span>}
          </span>
        </div>
        <Tree tree={tree} />
        {status.past > 0 && <button type="button" className="sm-btn sm-btn-light" style={{ width: '100%' }} disabled={busy} onClick={all}>Write all {status.past} past meetings</button>}
        <div className="fo-pair">
          <button type="button" className="sm-btn sm-btn-light" onClick={change}>Change folder</button>
          <button type="button" className="sm-btn sm-btn-red" onClick={stop}>Stop writing</button>
        </div>
      </div>
    </div>
  );
}

export default function Folder() {
  const tree = useTree();
  const [status, setStatus] = useState<FolderStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => folderStatus().then(setStatus).catch((error) => {
    console.error('Rekord: could not read the Rekord folder', error);
    setStatus({ state: 'off' });
  });
  useEffect(() => { void refresh(); }, []);

  const run = (step: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await step();
    } catch (error) {
      console.error('Rekord: could not write to the Rekord folder', error);
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const choose = run(chooseFolder);
  const handlers = { allow: run(allowFolder), all: run(writeAll), change: choose, stop: run(stopFolder) };

  const board = folderDev.board;
  if (board && board.on.state !== 'off') {
    return (
      <main className="sm-screen">
        <section className="fo-board-part" style={{ height: 480 }}><Header /><Off tree={tree} choose={() => undefined} /></section>
        <div className="fo-board-label">{board.label}</div>
        <section className="fo-board-part" style={{ height: 560 }}><Header /><On status={board.on} tree={tree} busy={false} {...handlers} /></section>
      </main>
    );
  }
  return (
    <main className="sm-screen">
      <Header />
      {status?.state === 'off' && <Off tree={tree} choose={() => void choose()} />}
      {status && status.state !== 'off' && <On status={status} tree={tree} busy={busy} {...handlers} />}
    </main>
  );
}
