/** Route stub for Settings; T8 builds its screens here (`?show=storage` and `?show=privacy` name the part to open). */
import { BackHeader } from '../ui';

export function Settings() {
  return (
    <div className="panel">
      <BackHeader title="Settings" />
    </div>
  );
}
