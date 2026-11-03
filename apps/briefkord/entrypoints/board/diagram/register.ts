import { createElement } from 'react';
import { extendBoard } from '../shell/extensions';
import { DiagramEdit } from './DiagramEdit';

extendBoard({
  editDiagram: (shell, cardId) => shell.openOverlay(createElement(DiagramEdit, { shell, cardId, key: `${cardId}-${Date.now()}` })),
});
