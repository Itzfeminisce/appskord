// Dev only: V4ReviewEditMore, "Edit decision" above "Edit question", as the 400 × 1240 board draws them.
import { M } from '@/lib/memory/sample';
import { ReviewEditForm } from '../screens/v4/ReviewEdit';

const noop = () => undefined;
const screen = { width: 400, height: 600, position: 'relative', overflow: 'hidden' } as const;

export default function ReviewEditBoard() {
  return (
    <div style={{ width: 400, background: '#F6F6F7' }}>
      <div style={screen}><ReviewEditForm meetingId={M.sarah3} itemId="n-rollout-16" onLeave={noop} /></div>
      <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E8E8EB', color: '#44464D', fontSize: 12 }}>Edit question</div>
      <div style={screen}><ReviewEditForm meetingId={M.sarah3} itemId="n-yearly" onLeave={noop} /></div>
    </div>
  );
}
