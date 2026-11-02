import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cut, Project } from '@/lib/project/types';
import { C, Icon } from '../ui';
import { chaptersInCut } from './chapters';
import { TL_ICONS } from './controls';
import { fitView, HEAD_PX } from './geometry';
import { Ruler } from './Ruler';
import { Toolbar } from './Toolbar';
import { ROW_PX } from './Tracks';

const ROWS: { name: string; icon: ReactNode; mute?: boolean }[] = [
  { name: 'Screen', icon: TL_ICONS.screen },
  { name: 'Camera', icon: TL_ICONS.camera, mute: true },
  { name: 'Voice', icon: TL_ICONS.mic, mute: true },
  { name: 'Zoom', icon: TL_ICONS.zoom },
  { name: 'Text', icon: TL_ICONS.text },
  { name: 'Music', icon: TL_ICONS.music, mute: true },
];

// Bar heights copied from the EditorOpening frame's voice row.
const WAVE = [7, 11, 9, 12, 12, 5, 4, 15, 8, 7, 17, 10, 15, 10, 13, 6, 13, 16, 11, 14, 13, 2, 5, 4, 3, 2, 16, 10, 14, 16, 14, 16, 9, 15, 10, 17, 16, 5, 6, 7];
const BAR = { position: 'absolute', left: 0, top: 2, bottom: 2, borderRadius: 5, background: C.raised, overflow: 'hidden', display: 'flex', alignItems: 'center' } as const;
const noop = () => {};

/** The timeline while the editor opens: tools, ruler and six named rows; the screen row reads the video. */
export function TimelineOpeningBody({ project, cut, length = 0 }: { project?: Project; cut?: Cut; length?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(100, el.clientWidth - HEAD_PX));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const view = fitView(length);
  const chapters = useMemo(() => (project && cut ? chaptersInCut(project, cut) : []), [project, cut]);
  const known = length > 0;
  return (
    <div ref={root} style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      <Toolbar view={view} length={length} snap hint="" waiting can={{ split: false, delete: false, speed: false, zoom: false, text: false, voiceover: false, media: false }}
        onSplit={noop} onDelete={noop} onSpeed={noop} onZoom={noop} onText={noop} onVoiceover={noop} onMedia={noop} onSnap={noop} onSlider={noop} onFit={noop} />
      {known ? <Ruler view={view} width={width} chapters={chapters} onScrub={noop} onFlag={noop} /> : (
        <div style={{ height: 22, flexShrink: 0, display: 'flex', borderBottom: `1px solid ${C.line}` }}><div style={{ width: HEAD_PX, background: C.panel }} /></div>
      )}
      {ROWS.map((row, i) => (
        <div key={row.name} style={{ display: 'flex', height: ROW_PX, boxSizing: 'content-box', borderBottom: `1px solid ${C.ground}` }}>
          <div style={{ width: HEAD_PX, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 10px', color: C.secondary, fontSize: 11.5, background: C.panel, boxSizing: 'border-box' }}>
            <Icon size={13}>{row.icon}</Icon>
            <span style={{ flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{row.name}</span>
            {row.mute && <Icon size={12} color={C.muted}>{TL_ICONS.sound}</Icon>}
            <Icon size={12} color={C.muted}>{TL_ICONS.eye}</Icon>
            <Icon size={12} color={C.muted}>{TL_ICONS.lock}</Icon>
          </div>
          <div style={{ flexGrow: 1, position: 'relative' }}>
            {i === 0 && <span style={{ ...BAR, width: '100%' }}><span style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, padding: '0 6px', whiteSpace: 'nowrap' }}>Reading video…</span></span>}
            {i === 1 && <span style={{ ...BAR, width: '100%' }} />}
            {i === 2 && (
              <span style={{ ...BAR, width: '62%' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%', width: '100%', padding: '0 4px', boxSizing: 'border-box' }}>
                  {WAVE.map((h, k) => <span key={k} style={{ flex: 1, height: h, background: C.muted, borderRadius: 1 }} />)}
                </span>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
