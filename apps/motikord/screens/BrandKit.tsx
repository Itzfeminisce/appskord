import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { editor } from '../entrypoints/editor/router';
import { sidepanel } from '../entrypoints/sidepanel/router';
import { applyBrandToStoredClip, BUILT_IN_FONT, loadKit, logoName, logoPath, registerBrandFonts, ROLE_LABEL, ROLES, saveFont, saveLogo } from '../lib/brand';
import { putBrandKit } from '../lib/db';
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
const small: CSSProperties = { height: 34, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: 'var(--surface)', color: 'var(--ink)', font: '600 12px/1 var(--font)', cursor: 'pointer' };

export default function BrandKit() {
  const { tab, panel } = useSurface();
  const [kit, setKit] = useState<Kit>();
  const [logoUrl, setLogoUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const colourInput = useRef<HTMLInputElement>(null);
  const editing = useRef<number>(-1);

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
    } catch (error) { console.error('Motikord: could not add the font', error); }
  };

  const setColour = (hex: string) => {
    if (!kit) return;
    const i = editing.current;
    const colours = kit.colours.map((c, k) => (k === i ? { ...c, hex } : c));
    if (i >= kit.colours.length) {
      const role = ROLES.find((r) => !kit.colours.some((c) => c.role === r));
      if (role) colours.push({ hex, role });
    }
    update({ colours });
  };
  const openPicker = (i: number) => { editing.current = i; colourInput.current?.click(); };
  const free = kit ? ROLES.some((r) => !kit.colours.some((c) => c.role === r)) : false;

  const apply = async () => {
    setBusy(true);
    try {
      if (tab) {
        const clipId = tab.route.params.clipId;
        if (clipId) await applyBrandToStoredClip(clipId);
        tab.navigate('Editor', { clipId });
      } else {
        await send({ type: 'brand/apply', clipId: undefined });
        await send({ type: 'editor/open', clipId: undefined });
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
          style={{ flexGrow: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--ink)', fontFamily: family === BUILT_IN_FONT ? 'var(--font)' : `'${family}', ${serif ? 'Georgia, serif' : 'system-ui, sans-serif'}`, fontSize: serif ? 18 : 16, fontWeight: serif ? 700 : 400, cursor: 'pointer' }}>
          {options.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
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
          <span style={{ width: 64, height: 64, borderRadius: 12, background: 'var(--ground)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: 52, maxHeight: 52 }} /> : <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--line-strong)' }} />}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
            <span style={{ fontSize: 13 }}>{logoId ? logoName(logoId) : ''}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Used in logo intros and end cards</span>
          </span>
          <button type="button" style={small} onClick={() => logoInput.current?.click()}>Replace</button>
          <input ref={logoInput} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </section>

      <section style={card}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Colours</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
          {kit.colours.map((c, i) => (
            <button key={c.role} type="button" aria-label={`${ROLE_LABEL[c.role]} ${c.hex}`} onClick={() => openPicker(i)}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'inherit' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: c.hex, border: '1px solid var(--line-strong)' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{c.hex.toUpperCase()}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{ROLE_LABEL[c.role]}</span>
            </button>
          ))}
          <button type="button" aria-label="Add a colour" disabled={!free} onClick={() => openPicker(kit.colours.length)}
            style={{ width: 44, height: 44, borderRadius: '50%', border: '1px dashed #A1A1AA', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: free ? 'pointer' : 'not-allowed', opacity: free ? 1 : 0.5, justifySelf: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <input ref={colourInput} type="color" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
            onChange={(e) => setColour(e.target.value.toUpperCase())} />
        </div>
      </section>

      <section style={card}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Fonts</span>
        <div>
          {fontRow('Headings', 'headingFont', true, false)}
          {fontRow('Body', 'bodyFont', false, true)}
        </div>
        <button type="button" style={{ ...small, alignSelf: 'flex-start', height: 32, fontWeight: 500 }} onClick={() => fontInput.current?.click()}>Add a font file</button>
        <input ref={fontInput} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" hidden onChange={(e) => { void addFont(e.target.files?.[0]); e.target.value = ''; }} />
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
        <button type="button" className={`btn btn-primary btn-block${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => void apply()}>Apply to the open clip</button>
        <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Saved as you go. Kept on this computer.</span>
      </div>
    </div>
  );
}
