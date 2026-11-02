import { useState } from 'react';
import { takeNumber, takesOver } from '@/lib/project/media';
import { updateLayer } from '@/lib/project/ops';
import { group } from '@/lib/project/history';
import { LABELS } from '@/lib/project/ops';
import type { Placed } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { Heading, Help, Slider, Switch } from '../timeline/controls';
import { C } from '../ui';

/** "take 2": shown beside Voiceover in the inspector header. */
export const takeLabel = (p: SlotProps, id: string): string => {
  const take = p.cut.voiceovers.find((v) => v.id === id);
  return take ? `take ${takeNumber(p.project, take)}` : '';
};

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The inspector body for a selected media file or voiceover take: volume, the original voice, and which take is heard. */
export function PlacedPanel({ p, kind, item }: { p: SlotProps; kind: 'media' | 'voiceovers'; item: Placed }) {
  const [volume, setVolume] = useState<number | null>(null);
  const patch = (id: string, change: Partial<Placed>) => p.edit((project) => updateLayer(project, { kind, id, patch: change }));
  const takes = kind === 'voiceovers' ? takesOver(p.project, item) : [];
  // Hearing one take silences the others over the same spot.
  const hear = (id: string) => p.edit((project) => group(project, LABELS.changed('voiceover', item.at), (q) => takes.reduce((r, t) => updateLayer(r, { kind, id: t.id, patch: { muted: t.id !== id } }), q)));
  return (
    <>
      <Heading>{kind === 'voiceovers' ? 'Voiceover' : 'Media'}</Heading>
      <Slider label="Volume" min={0} max={1} step={0.05} value={volume ?? item.volume} text={percent(volume ?? item.volume)} onInput={setVolume}
        onCommit={(v) => { setVolume(null); patch(item.id, { volume: v }); }} />
      {kind === 'voiceovers' && (
        <>
          <Switch label="Original voice" sub="Muted under the voiceover" on={!!item.muteOriginal} disabled={p.readOnly} onChange={(on) => patch(item.id, { muteOriginal: on })} />
          {takes.length > 1 && (
            <div role="radiogroup" aria-label="Takes" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {takes.map((t) => {
                const on = !t.muted;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} disabled={p.readOnly} onClick={() => hear(t.id)}
                    style={{ height: 30, padding: '0 10px', borderRadius: 8, border: `1px solid ${on ? C.accentText : C.line}`, background: C.raised, color: C.text, fontFamily: 'inherit', fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }}>
                    {`take ${takeNumber(p.project, t)}`}
                  </button>
                );
              })}
            </div>
          )}
          <Help>Each take is kept; pick one after.</Help>
        </>
      )}
    </>
  );
}
