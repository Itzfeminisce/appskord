import { createElement } from 'react';
import { listOrder } from '@/lib/board/ops';
import { liveBoard } from '../diagram/DiagramEdit';
import { diagramHooks } from '../diagram/hooks';
import { extendBoard } from '../shell/extensions';
import { BriefMe } from './BriefMe';
import { askHost, followChoice } from './choice';
import { DiagramFromText } from './DiagramFromText';
import { SuggestOrder } from './SuggestOrder';
import { Summarize } from './Summarize';
import './ai.css';

followChoice();

// Each action asks Chrome for the provider's site first, while the click still counts as a gesture.
extendBoard({
  briefMe: (shell) => {
    const asked = askHost();
    shell.openOverlay(createElement(BriefMe, { shell, asked, key: `brief-${Date.now()}` }));
  },
  summarize: (shell, cardId) => {
    const asked = askHost();
    shell.openOverlay(createElement(Summarize, { shell, cardId, asked, key: `summary-${Date.now()}` }));
  },
  suggestOrder: (shell) => {
    if (listOrder(liveBoard(shell)).length < 2) return;
    const asked = askHost();
    shell.openOverlay(createElement(SuggestOrder, { shell, asked, key: `order-${Date.now()}` }));
  },
  describeFlow: (shell) => shell.openOverlay(createElement(DiagramFromText, { shell, key: `diagram-${Date.now()}` })),
});

diagramHooks.describeChange = (shell, cardId) => shell.openOverlay(createElement(DiagramFromText, { shell, cardId, key: `diagram-${Date.now()}` }));
