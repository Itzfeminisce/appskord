import { lazy, Suspense } from 'react';

// The look guide is opened from Home or Look lock, not on every open, so it loads when asked for.
const View = lazy(() => import('./LookBibleView'));

/** LookBible, "Look guide". */
export default function LookBible() {
  return <Suspense fallback={<main data-frame="LookBible" style={{ flexGrow: 1 }} />}><View /></Suspense>;
}
