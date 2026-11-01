import { on, send as sendMessage, type MessageSender } from '@appskord/platform';
import type { Message } from './types';

export type MessageType = Message['type'];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** Sends a runtime message; resolves with the reply, or undefined when nothing is listening. */
export const send = <R = unknown>(msg: Message): Promise<R | undefined> => sendMessage<Message, R>(msg);

/** Listens for runtime messages; return undefined from the handler to ignore. Returns an unsubscribe function. */
export const onMessage = (handler: (msg: Message, sender: MessageSender) => unknown): (() => void) => on<Message>(handler);
