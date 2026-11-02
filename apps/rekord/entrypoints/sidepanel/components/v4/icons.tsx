const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const SearchIcon = () => (
  <svg {...base} width="18" height="18" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const SlidersIcon = () => (
  <svg {...base} width="18" height="18" strokeWidth="2"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
);
export const BackIcon = () => (
  <svg {...base} width="18" height="18" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
);
export const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const PauseIcon = ({ size = 18, stroke = 2 }: { size?: number; stroke?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth={stroke}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>
);
export const LockIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
