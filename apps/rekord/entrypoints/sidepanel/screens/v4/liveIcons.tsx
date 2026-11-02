// Icons the during-the-meeting frames draw, path for path.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

const EYE_OFF = 'M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.4 3.2M6.5 7.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9';
export const EyeOffIcon = ({ size = 18, stroke = 2 }: { size?: number; stroke?: number }) => <svg {...base} width={size} height={size} strokeWidth={stroke}><path d={EYE_OFF} /></svg>;
export const RecallIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.1"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2" /></svg>;
export const DotsIcon = () => <svg {...base} width="18" height="18" strokeWidth="2.4"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>;
export const DecisionMark = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><path d="M12 3l9 9-9 9-9-9z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>;
export const ActionMark = ({ size = 13 }: { size?: number }) => <svg {...base} width={size} height={size} strokeWidth="2.2"><path d="M4 12h12M12 7l5 5-5 5" /></svg>;
export const QuestionMark = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></svg>;
export const BookmarkIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.2"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
export const UpIcon = () => <svg {...base} width="16" height="16" strokeWidth="2.2"><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
export const TickIcon = () => <svg {...base} width="13" height="13" strokeWidth="3"><path d="M6 12.5l4 4 8-9" /></svg>;
export const SkipIcon = () => <svg {...base} width="14" height="14" strokeWidth="2.2"><path d="M5 5l9 7-9 7zM19 5v14" /></svg>;
export const TimerIcon = () => <svg {...base} width="13" height="13" strokeWidth="2.3"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>;
export const LockIcon = () => <svg {...base} width="15" height="15" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const WarnIcon = () => <svg {...base} width="18" height="18" strokeWidth="2.2"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>;
export const PlayIcon = () => <svg {...base} width="15" height="15" strokeWidth="2.2"><path d="M8 5l11 7-11 7z" /></svg>;
export const CopyIcon = () => <svg {...base} width="16" height="16" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>;
export const ListIcon = () => <svg {...base} width="12" height="12" strokeWidth="2.2"><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
