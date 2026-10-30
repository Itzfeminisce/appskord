import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { editor } from '../entrypoints/editor/router';
import { sidepanel } from '../entrypoints/sidepanel/router';
import { applyBrandToStoredClip, BUILT_IN_FONT, hasBrand, hexToHsv, hsvToHex, loadKit, logoName, logoPath, normHex, registerBrandFonts, REMOVABLE, ROLE_LABEL, ROLE_START, ROLES, saveFont, saveLogo, withColour, type Hsv } from '../lib/brand';
import { listClips, putBrandKit } from '../lib/db';
import { getMedia } from '../lib/media';
import { send } from '../lib/messages';
import type { BrandKit as Kit } from '../lib/types';

// Brand kit (BrandKit): saved as you go. Lives in the side panel and opens over the editor tab from "Brand".

/** Back and "Apply" work in whichever router the screen is shown in. */
function useSurface() {
  const tab = tryHook(editor.useRouter);
  const panel = tryHook(sidepanel.useRouter);
  return { tab, panel };
}
function tryHook<T>(hook: () => T): T | undefined {
  try { return hook(); } catch { return undefined; }
}

const card: CSSProperties = { margin: '10px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 };
type Role = Kit['colours'][number]['role'];

const field: CSSProperties = { height: 32, padding: '0 12px', borderRadius: 8, font: '500 12px/1 var(--font)', cursor: 'pointer' };

/** Colour area, hue slider and hex field, as in the colour-edit frame. */
function Picker({ hex, onChange, onRemove, onDone }: { hex: string; onChange: (hex: string) => void; onRemove?: () => void; onDone: () => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(hex));
  const [draft, setDraft] = useState(hex);
  const [h, sat, v] = hsv;
  const set = (next: Hsv) => { setHsv(next); const x = hsvToHex(next); setDraft(x); onChange(x); };
  const drag = (e: PointerEvent<HTMLDivElement>, move: (fx: number, fy: number) => void) => {
    const el = e.currentTarget;
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      move(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    el.setPointerCapture(e.pointerId);
    at(e);
    const onMove = (ev: globalThis.PointerEvent) => at(ev);
    const stop = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', stop); };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', stop);
  };
  const knob: CSSProperties = { position: 'absolute', borderRadius: '50%', border: '2px solid #FFFFFF', boxShadow: '0 0 0 1px rgba(17,17,20,0.4)', pointerEvents: 'none' };
  return (
    <div data-state="colour-edit" style={{ padding: 12, borderRadius: 12, background: 'var(--ground)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="slider" aria-label="Colour" aria-valuetext={hex} tabIndex={0} onPointerDown={(e) => drag(e, (fx, fy) => set([h, fx, 1 - fy]))}
        style={{ height: 96, borderRadius: 8, position: 'relative', touchAction: 'none', background: `linear-gradient(to top, #000000, rgba(0,0,0,0)), linear-gradient(to right, #FFFFFF, ${hsvToHex([h, 1, 1])})` }}>
        <span style={{ ...knob, left: `${sat * 100}%`, top: `${(1 - v) * 100}%`, width: 14, height: 14, margin: '-7px 0 0 -7px' }} />
      </div>
      <div role="slider" aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(h)} tabIndex={0} onPointerDown={(e) => drag(e, (fx) => set([fx * 360, sat, v]))}
        style={{ height: 12, borderRadius: 6, position: 'relative', touchAction: 'none', background: 'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)' }}>
        <span style={{ ...knob, left: `${(h / 360) * 100}%`, top: 6, width: 16, height: 16, margin: '-8px 0 0 -8px', background: hex }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor="brand-hex" style={{ fontSize: 12, color: 'var(--muted)' }}>Hex</label>
        <input id="brand-hex" value={draft} spellCheck={false} onChange={(e) => {
          setDraft(e.target.value);
          const x = normHex(e.target.value);
          if (x) { setHsv(hexToHsv(x)); onChange(x); }
        }} style={{ width: 96, height: 32, padding: '0 8px', border: '2px solid var(--accent)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
        <div style={{ flexGrow: 1 }} />
        {onRemove && <button type="button" onClick={onRemove} style={{ ...field, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: '#B91C1C' }}>Remove</button>}
        <button type="button" onClick={onDone} style={{ ...field, border: 0, background: 'var(--accent)', color: '#fff', fontWeight: 600 }}>Done</button>
      </div>
    </div>
  );
}

const small: CSSProperties = { height: 34, whiteSpace: 'nowrap', flexShrink: 0, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: 'var(--surface)', color: 'var(--ink)', font: '600 12px/1 var(--font)', cursor: 'pointer' };

export default function BrandKit() {
  const { tab, panel } = useSurface();
  const [kit, setKit] = useState<Kit>();
  const [logoUrl, setLogoUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Role>();
  const [removed, setRemoved] = useState<{ role: Role; hex: string }>();
  const [fontNote, setFontNote] = useState<string>();

  useEffect(() => {
    loadKit().then((k) => { setKit(k); void registerBrandFonts(k).then(() => setKit({ ...k })); })
      .catch((error: unknown) => console.error('Motikord: could not read the brand kit', error));
  }, []);

  const logoId = kit?.logoAssetId;
  useEffect(() => {
    let url: string | undefined;
    let live = true;
    setLogoUrl(undefined);
    if (logoId) {
      getMedia(logoPath(logoId)).then((f) => {
        if (!f || !live) return;
        url = URL.createObjectURL(f.type ? f : new Blob([f], { type: logoId.endsWith('svg') ? 'image/svg+xml' : 'image/png' }));
        setLogoUrl(url);
      }).catch((error: unknown) => console.error('Motikord: could not read the logo', error));
    }
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [logoId]);

  const update = (patch: Partial<Kit>) => {
    if (!kit) return;
    const next = { ...kit, ...patch };
    setKit(next);
    putBrandKit(next).catch((error: unknown) => console.error('Motikord: could not save the brand kit', error));
  };

  const back = () => (panel ? panel.back() : tab?.navigate('Editor'));

  const pickLogo = async (file: File | undefined) => {
    if (!file || !kit) return;
    try { update({ logoAssetId: await saveLogo(file, kit.logoAssetId) }); }
    catch (error) { console.error('Motikord: could not save the logo', error); }
  };
  const addFont = async (file: File | undefined) => {
    if (!file || !kit) return;
    try {
      const family = await saveFont(file);
      // The new font goes to Headings, or to Body when Headings already has one of yours.
      const heading = !kit.headingFont || kit.headingFont === BUILT_IN_FONT;
      update(heading ? { headingFont: family } : { bodyFont: family });
      setFontNote(heading ? `Added ${family} as your Headings font. Your next font file becomes the Body font.` : `Added ${family} as your Body font.`);
    } catch (error) { console.error('Motikord: could not add the font', error); }
  };

  const free = kit ? ROLES.find((r) => !kit.colours.some((c) => c.role === r)) : undefined;
  const setColour = (role: Role, hex: string) => { if (kit) update(withColour(kit, role, hex)); };
  const addColour = () => {
    if (!kit || !free) return;
    setRemoved(undefined);
    update(withColour(kit, free, ROLE_START[free]));
    setEditing(free);
  };
  const removeColour = (role: Role) => {
    const gone = kit?.colours.find((c) => c.role === role);
    if (!kit || !gone) return;
    update(withColour(kit, role, undefined));
    setRemoved({ role, hex: gone.hex });
    setEditing(undefined);
  };
  const undoRemove = () => {
    if (!kit || !removed) return;
    update(withColour(kit, removed.role, removed.hex));
    setRemoved(undefined);
  };

  /** The clip in this window's active editor tab, else another open editor tab's, else the newest clip. */
  const openClipId = async (): Promise<string | undefined> => {
    const base = browser.runtime.getURL('/editor.html');
    const editors = (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] }))
      .filter((c) => c.documentUrl?.startsWith(base) && new URL(c.documentUrl).searchParams.has('clip'));
    const win = await browser.windows.getCurrent();
    const [active] = await browser.tabs.query({ active: true, windowId: win.id });
    const pick = editors.find((c) => c.tabId === active?.id) ?? editors.find((c) => c.windowId === win.id) ?? editors[0];
    if (pick?.documentUrl) return new URL(pick.documentUrl).searchParams.get('clip') ?? undefined;
    return (await listClips())[0]?.id;
  };

  const apply = async () => {
    setBusy(true);
    try {
      if (tab) {
        const clipId = tab.route.params.clipId;
        if (clipId && await applyBrandToStoredClip(clipId)) void send({ type: 'clip/saved', clipId });
        tab.navigate('Editor', { clipId });
      } else {
        const clipId = await openClipId();
        if (!clipId) throw new Error('there is no clip to apply it to');
        const res = await send({ type: 'brand/apply', clipId });
        // No editor tab took it: change the stored clip; an editor that opens or reloads it shows the change.
        if (!res?.applied && await applyBrandToStoredClip(clipId)) void send({ type: 'clip/saved', clipId });
        await send({ type: 'editor/open', clipId });
      }
    } catch (error) {
      console.error('Motikord: could not apply the brand kit', error);
    } finally { setBusy(false); }
  };

  if (!kit) return <div role="status" aria-busy="true" style={{ flex: 1 }} />;
  const options = [...new Set([BUILT_IN_FONT, kit.headingFont, kit.bodyFont])].filter((f): f is string => !!f);
  const fontRow = (label: string, key: 'headingFont' | 'bodyFont', serif: boolean, last: boolean) => {
    const family = kit[key] ?? BUILT_IN_FONT;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: last ? 0 : '1px solid #EFEFF1' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', width: 70 }}>{label}</span>
        <select aria-label={label} value={family} onChange={(e) => update({ [key]: e.target.value })}
          style={{ flexGrow: 1, minWidth: 0, border: 0, background: 'transparent', appearance: 'none', padding: 0, color: 'var(--ink)', fontFamily: family === BUILT_IN_FONT ? 'var(--font)' : `'${family}', ${serif ? 'Georgia, serif' : 'system-ui, sans-serif'}`, fontSize: serif ? 18 : 16, fontWeight: serif ? 700 : 400, cursor: 'pointer' }}>
          {options.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: -8, pointerEvents: 'none' }}><path d="M6 9l6 6 6-6" /></svg>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{family === BUILT_IN_FONT ? 'Built in' : 'Your font'}</span>
      </div>
    );
  };

  return (
    <div data-screen="BrandKit" style={{ width: '100%', maxWidth: 400, margin: '0 auto', display: 'flex', flexDirection: 'column', paddingBottom: 0, flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--ground)', color: 'var(--ink)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <button type="button" className="icon-btn" aria-label="Back" onClick={back} style={{ width: 40, height: 40 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Brand kit</h1>
      </div>
      <p style={{ margin: '4px 24px 0', fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Your colours, fonts and logo. New clips use them, and so does “use my brand colours”.</p>

      <section style={card}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Logo</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span data-state={logoId ? undefined : 'brand-empty'} style={{ width: 64, height: 64, borderRadius: 12, boxSizing: 'border-box', background: logoId ? 'var(--ground)' : 'var(--surface)', border: logoId ? '1px solid var(--line)' : '1px dashed #A1A1AA', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: 52, maxHeight: 52 }} /> : logoId ? <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--line-strong)' }} /> : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 16l5-5 4 4 3-3 4 4" /></svg>
            )}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
            <span style={{ fontSize: 13 }}>{logoId ? logoName(logoId) : 'No logo yet'}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Used in logo intros and end cards</span>
          </span>
          <button type="button" style={small} onClick={() => logoInput.current?.click()}>{logoId ? 'Replace' : 'Add a logo'}</button>
          <input ref={logoInput} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </section>

      <section style={card}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Colours</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
          {kit.colours.map((c) => (
            <button key={c.role} type="button" aria-label={`${ROLE_LABEL[c.role]} ${c.hex}`} aria-pressed={editing === c.role} onClick={() => { setRemoved(undefined); setEditing(editing === c.role ? undefined : c.role); }}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'inherit' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', boxSizing: 'border-box', background: c.hex, border: '1px solid var(--line-strong)', boxShadow: editing === c.role ? '0 0 0 2px #FFFFFF, 0 0 0 4px var(--accent)' : undefined }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{c.hex.toUpperCase()}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{ROLE_LABEL[c.role]}</span>
            </button>
          ))}
          <button type="button" aria-label="Add a colour" disabled={!free} onClick={addColour}
            style={{ width: 44, height: 44, borderRadius: '50%', border: '1px dashed #A1A1AA', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: free ? 'pointer' : 'not-allowed', opacity: free ? 1 : 0.5, justifySelf: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        {editing && kit.colours.some((c) => c.role === editing) && (
          <Picker key={editing} hex={kit.colours.find((c) => c.role === editing)!.hex} onChange={(hex) => setColour(editing, hex)}
            onRemove={REMOVABLE.includes(editing) ? () => removeColour(editing) : undefined} onDone={() => setEditing(undefined)} />
        )}
        {removed && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ flexGrow: 1 }}>{`${ROLE_LABEL[removed.role]} removed. Text and Main can only be changed.`}</span>
            <button type="button" onClick={undoRemove} style={{ border: 0, background: 'transparent', padding: 0, color: 'var(--accent)', font: '600 12px/1 var(--font)', cursor: 'pointer' }}>Undo</button>
          </div>
        )}
        {!removed && !editing && kit.colours.length === 0 && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>No colours yet. Add up to four: text, main, accent and background.</span>}
        {!removed && !editing && !free && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Your kit holds four colours. Tap one to change or remove it.</span>}
      </section>

      <section style={card}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Fonts</span>
        <div>
          {fontRow('Headings', 'headingFont', true, false)}
          {fontRow('Body', 'bodyFont', false, true)}
        </div>
        <button type="button" style={{ ...small, alignSelf: 'flex-start', height: 32, fontWeight: 500 }} onClick={() => fontInput.current?.click()}>Add a font file</button>
        <input ref={fontInput} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden onChange={(e) => { void addFont(e.target.files?.[0]); e.target.value = ''; }} />
        {fontNote && <span role="status" style={{ fontSize: 12, lineHeight: 1.45, color: '#166534' }}>{fontNote}</span>}
      </section>

      <label style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Use for every new clip</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Templates take your colours and fonts too</span>
        </span>
        <input type="checkbox" checked={kit.useForNewClips} onChange={(e) => update({ useForNewClips: e.target.checked })} style={{ accentColor: 'var(--accent)', margin: 0, width: 18, height: 18 }} />
      </label>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy || !hasBrand(kit)} onClick={() => void apply()}>Apply to the open clip</button>
        <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>{hasBrand(kit) ? '' : 'Add a logo or a colour first. '}Saved as you go. Kept on this computer.</span>
      </div>
    </div>
  );
}
