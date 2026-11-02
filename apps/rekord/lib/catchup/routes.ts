// Background routes for the catch-up screens: every AI step runs here, never in a page (HANDOFF "Rules").
import type { Message, Meeting } from '../types';
import { askQuestions, catchupProgress, finishCatchup, readQuestions, skipQuestion, type PipelineDeps } from './pipeline';

export type FinishReply = { ok: true; meeting: Meeting } | { ok: false; error: string };

/** The reply to a catch-up message, or undefined when `msg` is not one. */
export function catchupRoute(msg: Message, deps: PipelineDeps = {}): Promise<unknown> | undefined {
  switch (msg.type) {
    case 'catchup/questions':
      return readQuestions(msg.meetingId);
    case 'catchup/ask-again':
      return askQuestions(msg.meetingId, deps);
    case 'catchup/skip':
      return skipQuestion(msg.meetingId, msg.questionId).then(() => catchupProgress(msg.meetingId));
    case 'catchup/progress':
      return catchupProgress(msg.meetingId);
    case 'catchup/finish':
      return finishCatchup(msg.meetingId, deps).then(
        (meeting): FinishReply => ({ ok: true, meeting }),
        (error: unknown): FinishReply => ({ ok: false, error: error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.' }),
      );
    default:
      return undefined;
  }
}
