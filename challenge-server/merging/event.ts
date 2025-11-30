// import { Event } from '@blert/common/generated/event_pb';

// import logger from '../log';

// /**
//  * Returns a unique key for the given event.
//  * @param event
//  */
// function eventKey(event: Event): string {
//   const type = event.getType();
//   switch (type) {
//     case Event.Type.DEPRECATED_CHALLENGE_START:
//     case Event.Type.DEPRECATED_CHALLENGE_END:
//     case Event.Type.DEPRECATED_CHALLENGE_UPDATE:
//     case Event.Type.DEPRECATED_STAGE_UPDATE:
//       return `deprecated-${type}`;

//     case Event.Type.PLAYER_UPDATE:
//       return `player-update-${event.getPlayer()!.getName()}`;
//   }

//   const _exhaustive: never = type;

//   logger.error('unknown_event_type', { type });
//   return `unknown-${type}`;
// }

// /**
//  * Returns a map of event keys to events.
//  * @param events Events to map.
//  * @returns The resulting map.
//  */
// export function eventKeyMap(events: Event[]): Map<string, Event> {
//   return new Map(events.map((event) => [eventKey(event), event]));
// }
