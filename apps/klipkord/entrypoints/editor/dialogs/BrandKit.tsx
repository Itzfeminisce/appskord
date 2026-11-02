import { useRef, useState } from 'react';
import { BRAND_FONTS, DEFAULT_BRAND_FONT, MAX_LOGO_LENGTH, brandFontFamily, colourOf, emptyKit, logoAssetId, withColour, type BrandKit as Kit, type BrandRecord, type BrandRole } from '@appskord/brand';
import { getPack } from '@appskord/scenes';
import { useBrand } from '../story/brand';
import { TL_ICONS, useEscape } from '../timeline/controls';
import { actionButton, C, Icon, iconButton, ICONS, MONO } from '../ui';

/** The BrandKit frame's colour names, in its order. */
const COLOURS: [BrandRole, string][] = [['primary', 'Main'], ['text', 'Ink'], ['background', 'Paper'], ['accent', 'Accent']];
/** Only the fonts bundled with Appskord; a font chosen in Motikord stays listed. */
const FONTS: readonly string[] = BRAND_FONTS;
// An unset colour shows the one cards draw with instead: the default pack's (scenes expand.ts lookFor).
const PALETTE = getPack('clean')?.palette;
const FALLBACK: Record<BrandRole, string> = {
  primary: PALETTE?.accent ?? '#2563EB', text: PALETTE?.ink ?? '#0F172A', background: PALETTE?.bg ?? '#FFFFFF', accent: PALETTE?.accent2 ?? PALETTE?.accent ?? '#2563EB',
};
const IMAGE_ICON = <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>;
const LINK_ICON = <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>;
const LABEL = { fontSize: 12, fontWeight: 600, color: C.secondary } as const;

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  reader.readAsDataURL(file);
});

function FontPicker({ prefix, value, onChange }: { prefix: string; value: string | undefined; onChange: (font: string) => void }) {
  const shown = value ?? DEFAULT_BRAND_FONT;
  const fonts = FONTS.includes(shown) ? FONTS : [shown, ...FONTS];
  // Headings draw bold, so their picker names the weight, as the frame does.
  const label = (f: string) => `${prefix}: ${f}${prefix === 'Headings' ? ' Bold' : ''}`;
  return (
    <span style={{ flex: 1, position: 'relative', display: 'flex' }}>
      <select aria-label={prefix} value={shown} onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', height: 34, borderRadius: 8, border: `1px solid ${C.line}`, background: C.raised, color: C.text, fontFamily: 'inherit', fontSize: 12.5, padding: '0 30px 0 10px', appearance: 'none', cursor: 'pointer' }}>
        {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: brandFontFamily(f) }}>{label(f)}</option>)}
      </select>
      <span aria-hidden="true" style={{ position: 'absolute', right: 10, top: 10, pointerEvents: 'none', color: C.text, display: 'flex' }}><Icon size={14}>{ICONS.down}</Icon></span>
    </span>
  );
}

/** BrandKit (dialog): logo, four colours and two fonts, shared with Motikord on this computer. */
export function BrandKit({ onClose, onSave }: { onClose: () => void; onSave: (record: BrandRecord) => Promise<void> }) {
  useEscape(onClose);
  const saved = useBrand();
  const [kit, setKit] = useState<Kit | null>(null);
  const [logo, setLogo] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // The draft follows the saved kit until the first change.
  const draft = kit ?? saved?.kit ?? emptyKit();
  const shownLogo = logo ?? saved?.logo;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await readAsDataUrl(file);
      if (url.length > MAX_LOGO_LENGTH) return setNote('That logo is too big. Use one under 512 KB.');
      setNote('');
      setLogo(url);
      setKit({ ...draft, logoAssetId: logoAssetId(file.type) });
    } catch (error) {
      console.error('Klipkord: could not read the logo', error);
    }
  };
  const save = () => {
    if (saving) return;
    setSaving(true);
    onSave({ kit: { ...draft, headingFont: draft.headingFont ?? DEFAULT_BRAND_FONT, bodyFont: draft.bodyFont ?? DEFAULT_BRAND_FONT }, ...(shownLogo && { logo: shownLogo }), updatedAt: Date.now() })
      .then(onClose, (error: unknown) => {
        console.error('Klipkord: could not save the brand kit', error);
        setSaving(false);
      });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,7,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Brand kit" style={{ width: 600, maxHeight: 600, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 16px 0 20px' }}>
          <div style={{ flexGrow: 1 }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Brand kit</h2></div>
          <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} style={iconButton()}><Icon>{TL_ICONS.close}</Icon></button>
        </div>
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 18, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={LABEL}>Logo</span>
              <span style={{ height: 96, borderRadius: 10, background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {shownLogo && <img src={shownLogo} alt="Logo" style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }} />}
              </span>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} style={actionButton('secondary')}><Icon size={15}>{IMAGE_ICON}</Icon><span>Replace</span></button>
              {note && <span role="alert" style={{ fontSize: 11.5, color: C.muted }}>{note}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={LABEL}>Colours</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {COLOURS.map(([role, name]) => {
                  const hex = colourOf(draft, role);
                  const shownHex = hex ?? FALLBACK[role];
                  return (
                    <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', position: 'relative' }}>
                      <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 7, background: shownHex, border: `1px solid ${C.line}`, boxSizing: 'border-box' }} />
                      <input type="color" aria-label={name} value={shownHex.toLowerCase()}
                        onChange={(e) => setKit(withColour(draft, role, e.target.value.toUpperCase()))}
                        style={{ position: 'absolute', left: 0, top: 0, width: 28, height: 28, opacity: 0, cursor: 'pointer' }} />
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 12 }}>{name}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{shownHex}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <span style={LABEL}>Fonts</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <FontPicker prefix="Headings" value={draft.headingFont} onChange={(headingFont) => setKit({ ...draft, headingFont })} />
                <FontPicker prefix="Text" value={draft.bodyFont} onChange={(bodyFont) => setKit({ ...draft, bodyFont })} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}`, fontSize: 12.5, color: C.secondary }}>
            <Icon size={15}>{LINK_ICON}</Icon><span style={{ flexGrow: 1 }}>Shared with Motikord on this computer. A change here shows in both apps.</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Used by cards, captions, backgrounds and the logo sting.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderTop: `1px solid ${C.line}` }}>
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={onClose} style={{ ...actionButton('ghost'), height: 32 }}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} style={{ ...actionButton('primary'), height: 32, background: C.accent, color: '#FFFFFF' }}>Save</button>
        </div>
      </div>
    </div>
  );
}
