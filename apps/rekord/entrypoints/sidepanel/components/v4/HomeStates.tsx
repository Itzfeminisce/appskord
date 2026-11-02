// The V4States banners Open loops shows above the list: offline, memory waiting or failed, the folder, notifications.
import { useCallback, useEffect, useState } from 'react';
import { providerName } from '@/lib/connection';
import { getMeeting } from '@/lib/db';
import { allowFolder, chooseFolder, folderStatus, type FolderStatus } from '@/lib/folder';
import { enqueueExtraction, QUEUE_KEY, readQueue } from '@/lib/memory/backfill';
import { getSettings } from '@/lib/settings';
import { useRouter } from '../../router';
import { StateBanner } from './states';

interface Seen {
  waiting?: { title: string; provider: string };
  failed?: { id: string; title: string };
  folder?: FolderStatus['state'];
  notificationsBlocked?: boolean;
}

const titleOf = async (id: string) => (await getMeeting(id))?.title;

async function look(): Promise<Seen> {
  const [queue, settings, folder] = await Promise.all([readQueue(), getSettings(), folderStatus().catch(() => ({ state: 'off' as const }))]);
  const seen: Seen = { folder: folder.state };
  const waitingId = queue.stopped === 'key' ? queue.ids[0] : undefined;
  const waitingTitle = waitingId && (await titleOf(waitingId));
  if (waitingTitle) seen.waiting = { title: waitingTitle, provider: providerName(settings.summary.provider) };
  const failedId = queue.failed?.[0];
  const failedTitle = failedId && (await titleOf(failedId));
  if (failedId && failedTitle) seen.failed = { id: failedId, title: failedTitle };
  if (settings.memory.brief.on || settings.memory.dueReminders) {
    const level = await Promise.resolve(browser.notifications?.getPermissionLevel?.()).catch(() => 'granted');
    seen.notificationsBlocked = level === 'denied';
  }
  return seen;
}

export function HomeStates() {
  const { navigate } = useRouter();
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [seen, setSeen] = useState<Seen>({});
  const refresh = useCallback(() => {
    look().then(setSeen).catch((error) => console.error('Rekord: could not check what needs attention', error));
  }, []);

  useEffect(() => {
    refresh();
    const net = () => setOnline(navigator.onLine !== false);
    const changed = (changes: Record<string, unknown>, area: string) => { if (area === 'local' && QUEUE_KEY in changes) refresh(); };
    addEventListener('online', net);
    addEventListener('offline', net);
    browser.storage.onChanged.addListener(changed);
    return () => {
      removeEventListener('online', net);
      removeEventListener('offline', net);
      browser.storage.onChanged.removeListener(changed);
    };
  }, [refresh]);

  const after = (step: () => Promise<unknown>) => () => {
    step().catch((error) => console.error('Rekord: could not fix that', error)).finally(refresh);
  };
  const { waiting, failed, folder, notificationsBlocked } = seen;
  if (online && !waiting && !failed && folder !== 'needsPermission' && folder !== 'missing' && !notificationsBlocked) return null;

  return (
    <div className="st4-stack">
      {!online && <StateBanner tone="plain" icon="off" title="You’re offline" body="Your meetings and memory are still here. Rekord will catch up when you’re back." />}
      {waiting && (
        <StateBanner tone="promise" icon="info" title={`Memory is waiting for ${waiting.provider}`}
          body={`Rekord will read “${waiting.title}” as soon as your ${waiting.provider} key is back.`}
          action={{ label: 'Check my key', kind: 'link', onClick: () => navigate('settings') }} />
      )}
      {failed && (
        <StateBanner alert tone="alert" icon="warn" title={`Memory failed for “${failed.title}”`} body="Nothing was lost. The transcript is safe."
          action={{ label: 'Try again', kind: 'primary', onClick: after(() => enqueueExtraction(failed.id)) }} />
      )}
      {folder === 'needsPermission' && (
        <StateBanner alert tone="warn" icon="warn" title="Chrome needs your OK to keep writing to Rekord folder." action={{ label: 'Allow', kind: 'primary', onClick: after(allowFolder) }} />
      )}
      {folder === 'missing' && (
        <StateBanner alert tone="alert" icon="warn" title="Rekord folder can’t be found" body="It may have been moved or deleted. Your notes are still in Rekord."
          action={{ label: 'Choose a folder', kind: 'primary', onClick: after(chooseFolder) }} />
      )}
      {notificationsBlocked && (
        <StateBanner tone="warn" icon="off" title="Notifications are blocked" body="Briefs and due-day reminders can’t reach you."
          action={{ label: 'Turn on in Windows Settings', kind: 'link', onClick: () => void browser.tabs.create({ url: 'ms-settings:notifications' }).catch(() => undefined) }} />
      )}
    </div>
  );
}
