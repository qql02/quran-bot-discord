// Entry point for every component/modal whose customId starts with "wird:". Only routes — the work is in the sibling files.
import { GOAL_OPTIONS } from '../../utils/wird.js';
import { MODAL_SUB, MODAL_CUSTOM, MODAL_GOAL, MODAL_PAGES } from '../ui/index.js';
import { readerOnly } from './shared.js';
import {
  startSubscription, showStatus, stopSubscription, askDelete, confirmDelete, onSubscribeModal, renew, editSettings, toggleAdhkar
} from './subscription.js';
import {
  applyGoal, onPlanMenu, onGoalModal, onPagesModal, recalcGoal, openGoalModal, openPagesModal
} from './plan.js';

export { startSubscription, showStatus, stopSubscription, askDelete };

export async function handleWird(interaction) {
  const id = interaction.customId;

  if (interaction.isModalSubmit()) {
    if (id === MODAL_SUB)    return onSubscribeModal(interaction);
    if (id === MODAL_CUSTOM) return readerOnly(interaction);
    if (id === MODAL_GOAL)   return onGoalModal(interaction);
    if (id === MODAL_PAGES)  return onPagesModal(interaction);
    return;
  }
  if (interaction.isStringSelectMenu?.()) return onPlanMenu(interaction);
  if (!interaction.isButton()) return;

  // Buttons from older messages (before the plan menus existed) keep working.
  if (id.startsWith('wird:goal:')) { const d = Number(id.slice('wird:goal:'.length)); return GOAL_OPTIONS.includes(d) ? applyGoal(interaction, d) : undefined; }

  switch (id) {
    case 'wird:subscribe':    return startSubscription(interaction);
    case 'wird:me':           return showStatus(interaction);
    case 'wird:done':
    case 'wird:custom':       return readerOnly(interaction);      // direct logging no longer exists
    case 'wird:renew':        return renew(interaction);
    case 'wird:stop':         return stopSubscription(interaction);
    case 'wird:delete':       return askDelete(interaction);
    case 'wird:delete:yes':   return confirmDelete(interaction);
    case 'wird:delete:no':    return showStatus(interaction);
    case 'wird:recalc':       return recalcGoal(interaction);
    case 'wird:goalcustom':   return openGoalModal(interaction);
    case 'wird:pages':        return openPagesModal(interaction);
    case 'wird:edit':         return editSettings(interaction);
    case 'wird:adhkar:morning': return toggleAdhkar(interaction, 'morning');
    case 'wird:adhkar:evening': return toggleAdhkar(interaction, 'evening');
  }
}
