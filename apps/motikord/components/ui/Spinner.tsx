/** Spinner; pass `label` (frame copy) for screen readers when it stands alone. */
export function Spinner({ label, size = 20 }: { label?: string; size?: number }) {
  return label
    ? <span className="spinner" role="status" aria-label={label} style={{ width: size, height: size }} />
    : <span className="spinner" aria-hidden="true" style={{ width: size, height: size }} />;
}
