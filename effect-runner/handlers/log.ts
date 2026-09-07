import { ALL_EFFECT_EVENT_KINDS, EffectEventKind } from '../effects';
import logger from '../log';
import { EffectHandler, SINGLE_MESSAGE_KEY } from '../runner';

/** Logs every effect event at info level. */
export const logHandler: EffectHandler = {
  key: 'log',
  kinds: ALL_EFFECT_EVENT_KINDS,

  plan() {
    return Promise.resolve([SINGLE_MESSAGE_KEY]);
  },

  deliver(event) {
    logger.info('log_handler_event', {
      eventId: event.id.toString(),
      kind: EffectEventKind[event.kind],
      subject: event.subject,
      createdAt: event.createdAt.toISOString(),
    });
    return Promise.resolve({ status: 'delivered' });
  },
};
