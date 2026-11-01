import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Full width, 44 px tall (footer actions). */
  block?: boolean;
  /** Shows a spinner and blocks clicks while work runs; the label stays so the button keeps its size. */
  busy?: boolean;
  /** What the spinner announces while busy. */
  busyLabel?: string;
}

export function Button({ variant = 'primary', block, busy, busyLabel, className, type = 'button', disabled, children, onClick, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, block && 'btn-block', busy && 'is-busy', className].filter(Boolean).join(' ');
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {busy && <Spinner size={14} label={busyLabel} />}
      <span className="btn-label">{children}</span>
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon buttons have no visible text. */
  'aria-label': string;
  busy?: boolean;
}

export function IconButton({ className, type = 'button', busy, children, onClick, ...rest }: IconButtonProps) {
  const cls = ['icon-btn', busy && 'is-busy', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} aria-busy={busy || undefined} onClick={busy ? undefined : onClick} {...rest}>
      {busy ? <Spinner size={14} /> : children}
    </button>
  );
}
