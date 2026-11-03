/** Inline stroke icons from the panel frames. */
import type { ReactNode, SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

function Stroke({ size = 18, sw = 2, children, ...rest }: Props & { sw?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function LogoMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="9" rx="2" fill="#FFFFFF" />
      <rect x="13" y="4" width="7" height="5" rx="2" fill="#FFFFFF" />
      <rect x="13" y="11" width="7" height="9" rx="2" fill="#14B8A6" />
      <rect x="4" y="15" width="7" height="5" rx="2" fill="#FFFFFF" />
    </svg>
  );
}

export const SearchIcon = (p: Props) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Stroke>
);
export const SettingsIcon = (p: Props) => (
  <Stroke sw={1.8} {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Stroke>
);
export const BoardIcon = (p: Props) => (
  <Stroke {...p}>
    <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
    <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
  </Stroke>
);
export const ChevronDown = (p: Props) => (
  <Stroke size={16} {...p}>
    <path d="m8 10 4 4 4-4" />
  </Stroke>
);
export const BackIcon = (p: Props) => (
  <Stroke {...p}>
    <path d="m14 6-6 6 6 6" />
  </Stroke>
);
export const PlusIcon = (p: Props) => (
  <Stroke size={16} sw={2.2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
);
export const OpenIcon = (p: Props) => (
  <Stroke size={16} {...p}>
    <path d="M7 17 17 7M9 7h8v8" />
  </Stroke>
);
export const CheckIcon = (p: Props) => (
  <Stroke size={14} sw={3} {...p}>
    <path d="m5 12 5 5 9-10" />
  </Stroke>
);
export const LinkIcon = (p: Props) => (
  <Stroke size={13} {...p}>
    <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </Stroke>
);
export const ImageIcon = (p: Props) => (
  <Stroke size={15} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-9 9" />
  </Stroke>
);
export const NoteIcon = (p: Props) => (
  <Stroke size={15} {...p}>
    <path d="M5 4h14v12l-4 4H5z" />
    <path d="M9 9h6M9 13h4" />
  </Stroke>
);
export const FileIcon = (p: Props) => (
  <Stroke size={15} {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Stroke>
);
export const ListIcon = (p: Props) => (
  <Stroke size={15} {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Stroke>
);
export const SparkIcon = (p: Props) => (
  <Stroke {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m7.5 7.5 2 2M14.5 14.5l2 2M16.5 7.5l-2 2M9.5 14.5l-2 2" />
  </Stroke>
);
export const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const ImportIcon = (p: Props) => (
  <Stroke size={15} {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Stroke>
);
export const LockIcon = (p: Props) => (
  <Stroke size={16} {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Stroke>
);
export const WindowIcon = (p: Props) => (
  <Stroke size={28} sw={1.8} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
  </Stroke>
);
export const SpinnerIcon = (p: Props) => (
  <Stroke size={16} sw={2.4} className="p-spin" {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Stroke>
);
