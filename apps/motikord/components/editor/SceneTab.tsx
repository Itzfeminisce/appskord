import { CAMERA_LABELS } from '@appskord/motion/camera';
import { DEPTH_LABELS } from '@appskord/motion/depth';
import { DEPTHS, PARALLAX } from '@appskord/motion/types';
import { useEditorV3 } from './context';
import { amountFrom, amountValue, CAMERA_ORDER, cameraSummary } from './edits';
import { editScene, templateName } from './model';
import { C, Chip, Field, hint, Section, Slider } from './ui';

// CameraDepth: the scene's camera move, amount, focus, depth layers, depth blur and depth shadows.

export const NOTHING_SHARP = 'Nothing (all sharp)';

export function SceneTab() {
  const ed = useEditorV3();
  const { scene, state } = ed;
  const i = state.scene;
  const cam = scene.camera;
  const edit = (fn: Parameters<typeof editScene>[2], summary: string, mergeKey?: string) =>
    ed.update((st) => editScene(st, i, fn, { summary, mergeKey }));
  const focusable = scene.layers.filter((l) => l.kind !== 'particles');
  const moves = cam.move !== 'hold' && cam.move !== 'rack-focus';
  const unit = cam.move === 'orbit' ? '°' : '%';
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0 12px' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {`Scene ${i + 1}`} <span style={{ fontWeight: 400, color: C.muted }}>{`· ${templateName(scene)}`}</span>
        </span>
      </div>
      <Section title="Camera and depth" aside="2.5D" changed={ed.changed?.scene === ed.state.scene && ed.changed.sections.includes('Camera and depth')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CAMERA_ORDER.map((m) => (
            <Chip key={m} on={cam.move === m} onClick={() => edit((s) => { s.camera.move = m; }, cameraSummary(m, cam.amount))}>
              {CAMERA_LABELS[m]}
            </Chip>
          ))}
        </div>
        <Slider name="Amount" min={0} max={cam.move === 'orbit' ? 30 : 100} value={amountValue(cam.move, cam.amount)} text={`${amountValue(cam.move, cam.amount)}${unit}`} disabled={!moves}
          onChange={(v) => edit((s) => { s.camera.amount = amountFrom(cam.move, v) * (cam.amount < 0 ? -1 : 1); }, cameraSummary(cam.move, amountFrom(cam.move, v)), `camera:${scene.id}`)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Field name="Starts" value="0.0 s" />
          <Field name="Ends" value={`${(scene.ms / 1000).toFixed(1)} s`} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: C.muted }}>Focus on:</span>
          <select aria-label="Focus on" value={cam.focus ?? ''} style={{ flex: 1, height: 30, borderRadius: 7, border: '1px solid #E0E0E4', font: 'inherit' }}
            onChange={(e) => {
              const id = e.currentTarget.value;
              const l = scene.layers.find((x) => x.id === id);
              edit((s) => { if (id) s.camera.focus = id; else delete s.camera.focus; }, `Focus on: ${l ? ed.name(l) : NOTHING_SHARP}`);
            }}>
            {focusable.map((l) => <option key={l.id} value={l.id}>{ed.name(l)}</option>)}
            <option value="">{NOTHING_SHARP}</option>
          </select>
        </label>
      </Section>
      <Section title="Depth layers" aside="Further back moves less">
        {DEPTHS.map((d) => (
          <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{DEPTH_LABELS[d]}</span>
              <span style={{ ...hint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {scene.layers.filter((l) => l.depth === d).map((l) => ed.name(l)).join(', ')}
              </span>
            </span>
            <span style={{ width: 70 }}>
              <Field name="Moves" value={`${PARALLAX[d].toFixed(1)}×`} />
            </span>
          </div>
        ))}
      </Section>
      <Section title="Depth blur">
        <Slider name="Depth blur" min={0} max={3} value={scene.depthBlur === 'soft' ? 3 : 0} text={scene.depthBlur === 'soft' ? 'Soft' : NOTHING_SHARP}
          onChange={(v) => edit((s) => { s.depthBlur = v > 0 ? 'soft' : 'nothing'; }, `Depth blur: ${v > 0 ? 'Soft' : NOTHING_SHARP}`)} />
      </Section>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 0', borderTop: '1px solid #E8E8EB' }}>
        <input type="checkbox" aria-label="Depth shadows" checked={!!scene.depthShadows}
          onChange={(e) => { const on = e.currentTarget.checked; edit((s) => { if (on) s.depthShadows = true; else delete s.depthShadows; }, 'Depth shadows'); }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Depth shadows</span>
          <span style={hint}>Front layers cast soft shadows on the ones behind.</span>
        </span>
      </label>
    </div>
  );
}
