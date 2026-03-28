import { Client, EventOutputDTO, EventSearchInputAllowedFiltersEventNameEnum } from '@takaro/apiclient';

export interface WaitForEventOptions {
  eventName: EventSearchInputAllowedFiltersEventNameEnum;
  gameserverId: string;
  /** Only return events created after this timestamp */
  after: Date;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Poll interval in milliseconds (default: 1000) */
  pollInterval?: number;
}

export async function waitForEvent(client: Client, options: WaitForEventOptions): Promise<EventOutputDTO> {
  const {
    eventName,
    gameserverId,
    after,
    timeout = 30000,
    pollInterval = 1000,
  } = options;

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await client.event.eventControllerSearch({
      filters: {
        eventName: [eventName],
        gameserverId: [gameserverId],
      },
      greaterThan: {
        createdAt: after.toISOString(),
      },
    });

    const events = result.data.data;
    if (events.length > 0) {
      return events[0]!;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timed out waiting for event '${eventName}' on gameserver '${gameserverId}' after ${timeout}ms`,
  );
}
