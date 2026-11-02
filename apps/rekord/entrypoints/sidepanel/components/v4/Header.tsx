import { BrandMark } from '../TopBar';
import { useRouter } from '../../router';
import { SearchIcon, SlidersIcon } from './icons';

/** The 56 px v4 header: Rekord mark, Ask and Settings. */
export function Header({ loose = false }: { loose?: boolean }) {
  const { navigate } = useRouter();
  return (
    <header className={loose ? 'v4-head v4-head-loose' : 'v4-head'}>
      <div className="brand">
        <BrandMark />
        Rekord
      </div>
      <div className="v4-head-icons">
        <button type="button" className="v4-icon" aria-label="Ask all meetings" onClick={() => navigate('askall')}><SearchIcon /></button>
        <button type="button" className="v4-icon" aria-label="Settings" onClick={() => navigate('settingsMemory')}><SlidersIcon /></button>
      </div>
    </header>
  );
}
