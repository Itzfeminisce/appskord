/** Inline stroke icons from the frames. */
import type { ReactNode } from 'react';

const stroke = (size: number, children: ReactNode, width = 2, extra: Record<string, string> = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...extra}>
    {children}
  </svg>
);

export const Logo = () => (
  <span className="bk-logo" aria-hidden="true">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="7" height="9" rx="2" fill="var(--bk-card)" />
      <rect x="13" y="4" width="7" height="5" rx="2" fill="var(--bk-card)" />
      <rect x="13" y="11" width="7" height="9" rx="2" fill="var(--bk-logo-teal)" />
      <rect x="4" y="15" width="7" height="5" rx="2" fill="var(--bk-card)" />
    </svg>
  </span>
);

export const ChevronRight = ({ size = 14 }: { size?: number }) => stroke(size, <path d="m9 6 6 6-6 6" />);
export const ChevronLeft = ({ size = 18 }: { size?: number }) => stroke(size, <path d="m14 6-6 6 6 6" />);
export const ChevronDown = () => stroke(16, <path d="m8 10 4 4 4-4" />);
export const Check = () => stroke(13, <path d="m5 12 5 5 9-10" />, 2.4);
export const CanvasIcon = () => stroke(14, <><rect x="3.5" y="3.5" width="7" height="8" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="14.5" width="7" height="6" rx="1.5" /></>);
export const ListIcon = () => stroke(14, <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h1M4 12h1M4 18h1" /></>);
export const SearchIcon = ({ size = 18 }: { size?: number }) => stroke(size, <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>);
export const UndoIcon = () => stroke(18, <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const RedoIcon = () => stroke(18, <><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>);
export const Sparkle = ({ size = 15, small }: { size?: number; small?: boolean }) =>
  stroke(size, <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />{!small && <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />}</>);
export const ShareIcon = () => stroke(15, <><path d="M12 15V4M7 9l5-5 5 5" /><path d="M5 14v5h14v-5" /></>);
export const UploadIcon = ({ size = 24 }: { size?: number }) => stroke(size, <><path d="M12 15V4M7 9l5-5 5 5" /><path d="M5 14v5h14v-5" /></>);
export const DownloadIcon = ({ size = 24 }: { size?: number }) => stroke(size, <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const Play = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
);
export const Close = ({ size = 18 }: { size?: number }) => stroke(size, <path d="M6 6l12 12M18 6 6 18" />);
export const More = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
);
export const Trash = ({ size = 16 }: { size?: number }) => stroke(size, <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const Refresh = ({ size = 14 }: { size?: number }) => stroke(size, <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5M20 4v4.5h-4.5" />);
/** A gear, not the frames' sun-like mark, which read as brightness. */
export const Settings = () => stroke(18, <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>, 1.8);

export const ToolSelect = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3l14 8-6 1.6L10 19z" /></svg>
);
export const ToolNote = () => stroke(18, <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /></>, 1.9);
export const ToolChecklist = () => stroke(18, <><path d="m4 7 2 2 3-3M4 15l2 2 3-3" /><path d="M12 8h8M12 16h8" /></>, 1.9);
export const ToolDiagram = () => stroke(18, <><rect x="3" y="4" width="7" height="5" rx="1.5" /><rect x="14" y="15" width="7" height="5" rx="1.5" /><path d="M6.5 9v4.5h11V15" /></>, 1.9);
export const ToolArrow = () => stroke(18, <path d="M5 19 19 5M10 5h9v9" />, 1.9);
export const ToolGroup = () => stroke(18, <rect x="3.5" y="4.5" width="17" height="15" rx="3" />, 1.9, { strokeDasharray: '3 2.5' });
export const ToolAttach = () => stroke(18, <path d="M20 12.5 12.6 20a5 5 0 0 1-7-7L13 5.5a3.3 3.3 0 0 1 4.7 4.7l-7.3 7.3a1.7 1.7 0 0 1-2.4-2.4L14.5 8.5" />, 1.9);
