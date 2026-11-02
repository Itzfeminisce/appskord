import { useState } from 'react';
import { exportDeps, getExport, setExport, shareItem, type DoneItem } from '../components/Exporting';
import { StateCard } from '../states/StateCard';
import { Seg } from '../timeline/controls';
import { C, MONO } from '../ui';
import { DialogButton, ExportModal } from './ExportVideo';
import { sizeText } from '@/lib/export/estimate';
import { setAnyone } from '@/lib/export/share';

const LINK = <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>;

/** Keeps the Done list and the open dialog on the same share. */
function update(item: DoneItem): void {
  const s = getExport();
  setExport({ done: s.done.map((d) => (d.key === item.key ? item : d)), share: item });
}

/** ShareLink ("Link ready"), or drive-connect when Google is not connected yet. */
export function ShareLink({ item, onClose }: { item: DoneItem; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const share = item.share;

  if (!share) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,7,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{ width: 380 }}>
          <StateCard state="drive-connect" role="dialog" title="Connect Google Drive" body="Klipkord can only see the files it uploads."
            actions={[{ label: 'Connect Google', tone: 'primary', onClick: () => { onClose(); void shareItem(item, true); } }]} />
        </div>
      </div>
    );
  }

  const who = async (anyone: boolean) => {
    setBusy(true);
    try {
      const token = await exportDeps.token(true);
      if (token) update({ ...item, share: await setAnyone(exportDeps.fetch, token, share, anyone) });
    } catch (error) {
      console.error('Klipkord: could not change who can watch', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ExportModal label="Link ready" sub="Anyone with the link can watch. They don't need Klipkord." width={560} onClose={onClose}
      footer={<>
        <DialogButton tone="raised" onClick={() => window.open(share.link, '_blank')}>Open in Drive</DialogButton>
        <DialogButton tone="ghost" disabled={busy || !share.permissionId} onClick={() => void who(false)}>Stop sharing</DialogButton>
        <span style={{ flexGrow: 1 }} />
        <DialogButton tone="accent" onClick={onClose}>Done</DialogButton>
      </>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input aria-label="Share link" readOnly value={share.link} onFocus={(e) => e.target.select()}
          style={{ flexGrow: 1, height: 36, borderRadius: 8, border: `1px solid ${C.line}`, background: C.ground, color: C.text, padding: '0 10px', fontFamily: MONO, fontSize: 12 }} />
        <DialogButton tone="accent" icon={LINK} onClick={() => void exportDeps.copy(share.link).catch((error: unknown) => console.error('Klipkord: could not copy the link', error))}>Copy link</DialogButton>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, color: C.secondary }}>Who can watch</span>
        <Seg label="Who can watch" options={[{ value: 'anyone', label: 'Anyone with the link' }, { value: 'added', label: 'Only people I add' }]}
          value={share.permissionId ? 'anyone' : 'added'} onChange={(v) => { if (!busy) void who(v === 'anyone'); }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 12.5 }}>
        <span style={{ color: C.secondary }}>Uploaded</span><span>{`${item.label} · ${sizeText(item.size)}`}</span>
        <span style={{ color: C.secondary }}>To</span><span>Klipkord folder in your Google Drive</span>
        <span style={{ color: C.secondary }}>Not uploaded</span><span>The project, the transcript and other cuts</span>
      </div>
    </ExportModal>
  );
}
