/** Spinner. Pass `label` (the app's copy) when it stands alone so screen readers announce it; without one it is decorative. */
export function Spinner({ label, size = 20 }: { label?: string; size?: number }) {
  return label ? (
    <span className="spinner" role="status" aria-label={label} style={{ width: size, height: size }} />
  ) : (
    <span className="spinner" aria-hidden="true" style={{ width: size, height: size }} />
  );
}
