/** Stand-in for a frame that a later task builds. Shows only the frame name. */
export function Placeholder({ name }: { name: string }) {
  return (
    <main className="placeholder" data-frame={name}>
      <h1 className="placeholder-name">{name}</h1>
    </main>
  );
}
