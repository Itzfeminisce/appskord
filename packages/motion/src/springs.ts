// A closed-form damped spring, so a frame never depends on the frames before it.

// Residual left when the spring counts as settled; it then snaps to exactly 1.
const SETTLED = 1e-4;

/** Damping ratio for "Spring · {bounce}% bounce": 0% is critically damped, higher bounces more. */
export function dampingRatio(bounce: number): number {
  return 1 - Math.min(Math.max(bounce, 0), 95) / 100;
}

/** Spring easing over u in 0..1, where u = 1 is the settle time. Starts at rest at 0, ends at 1, may overshoot. */
export function springEase(bounce: number): (u: number) => number {
  const zeta = dampingRatio(bounce);
  if (zeta >= 1) {
    // Critically damped: solve e^-w (1 + w) = SETTLED for w by Newton's method once.
    let w = 10;
    for (let i = 0; i < 20; i++) w -= (Math.exp(-w) * (1 + w) - SETTLED) / (-w * Math.exp(-w));
    return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-w * u) * (1 + w * u));
  }
  const w = Math.log(1 / SETTLED) / zeta;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return 1 - Math.exp(-zeta * w * u) * (Math.cos(wd * u) + ((zeta * w) / wd) * Math.sin(wd * u));
  };
}

/** Position of a spring released toward 1 after `elapsed` ms, settling at `ms`. */
export function springAt(bounce: number, ms: number, elapsed: number): number {
  return springEase(bounce)(ms <= 0 ? 1 : elapsed / ms);
}
