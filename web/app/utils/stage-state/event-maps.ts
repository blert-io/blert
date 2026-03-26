import { Event } from '@blert/common';

import { EventTickMap, EventTypeMap } from './types';

/**
 * Incrementally accumulates events into tick-indexed and type-indexed maps.
 */
export class EventMapBuilder {
  private byTick: EventTickMap = {};
  private byType: EventTypeMap = {};

  get eventsByTick(): Readonly<EventTickMap> {
    return this.byTick;
  }

  get eventsByType(): Readonly<EventTypeMap> {
    return this.byType;
  }

  /**
   * Appends events to the accumulated maps.
   */
  append(events: Event[]): void {
    for (const event of events) {
      this.byTick[event.tick] ??= [];
      this.byTick[event.tick].push(event);

      this.byType[event.type] ??= [];
      this.byType[event.type].push(event);
    }
  }

  clear(): void {
    this.byTick = {};
    this.byType = {};
  }
}

/**
 * Builds tick-indexed and type-indexed event maps from an event array.
 */
export function buildEventMaps(events: Event[]): [EventTickMap, EventTypeMap] {
  const builder = new EventMapBuilder();
  builder.append(events);
  return [builder.eventsByTick, builder.eventsByType];
}
