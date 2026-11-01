import type { HTMLAttributes } from 'react';

export type CardTone = 'plain' | 'warning' | 'error' | 'success' | 'accent';

export function Card({ tone = 'plain', className, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: CardTone }) {
  return <div className={['card', `card-${tone}`, className].filter(Boolean).join(' ')} {...rest} />;
}
