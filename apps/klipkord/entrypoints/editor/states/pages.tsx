import { FullPage, StateCard } from './StateCard';

/** The smallest window the editor lays out in. */
export const MIN_WIDTH = 1280;
export const MIN_HEIGHT = 600;

export const isWindowSmall = (width: number, height: number): boolean => width < MIN_WIDTH || height < MIN_HEIGHT;

export function WindowSmall({ width, height }: { width: number; height: number }) {
  return (
    <FullPage>
      <StateCard state="window-small" role="alert" title="Make this window wider"
        body={`The editor needs at least ${MIN_WIDTH} by ${MIN_HEIGHT}. Yours is ${width} by ${height}.`} />
    </FullPage>
  );
}

export function NoProject({ onLibrary }: { onLibrary: () => void }) {
  return (
    <FullPage>
      <StateCard state="no-project" title="Pick a recording to edit"
        body="This tab was opened without a recording. Your recordings are in the library."
        actions={[{ label: 'Open the library', tone: 'primary', onClick: onLibrary }]} />
    </FullPage>
  );
}
