import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Full-width, 48px tall (footer actions). */
  block?: boolean;
  /** Shows a spinner and ignores clicks while work runs; the label stays so the button keeps its size. */
  busy?: boolean;
  /** What the spinner announces while busy. */
  busyLabel?: string;
}

export function Button({
  variant = 'primary',
  block,
  busy,
  busyLabel,
  className,
  type = 'button',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, block && 'btn-block', busy && 'is-busy', className].filter(Boolean).join(' ');
  if (!busy)
    return (
      <button type={type} className={cls} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  return (
    <button type={type} className={cls} aria-busy="true" aria-disabled="true" {...rest} onClick={(e) => e.preventDefault()}>
      <Spinner size={14} label={busyLabel} />
      {children}
    </button>
  );
}
