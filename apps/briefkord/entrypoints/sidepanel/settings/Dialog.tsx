/** The dialog shell and the few icons Settings adds to the panel's set. */
import { useEffect, type ReactNode } from 'react';

export function Dialog({ label, wide = true, onClose, children }: { label: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="st-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-label={label} className={`st-dialog${wide ? '' : ' is-penv'}`}>
        {children}
      </section>
    </div>
  );
}

const icon = (d: ReactNode, size = 18, sw = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const CloseIcon = () => icon(<path d="M6 6l12 12M18 6 6 18" />);
export const EyeIcon = () => icon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOffIcon = () => icon(<><path d="M3 3l18 18" /><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
export const ChevronIcon = () => icon(<path d="m6 9 6 6 6-6" />, 14);
export const SmallCheck = () => icon(<path d="m5 12 5 5 9-10" />, 13, 3);
export const Spin = ({ size = 18 }: { size?: number }) => (
  <svg className="st-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);
