import { randomUUID } from 'crypto';
import { getMockServer } from '@takaro/mock-gameserver';
import { Client, GameServerOutputDTO, PlayerOnGameserverOutputDTO } from '@takaro/apiclient';
import { Redis } from '@takaro/db';
import { config } from 'dotenv';

config();

type MockGameServer = Awaited<ReturnType<typeof getMockServer>>;

export interface MockServerContext {
  server: MockGameServer;
  gameServer: GameServerOutputDTO;
  players: PlayerOnGameserverOutputDTO[];
  identityToken: string;
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry<T>(fn: () => Promise<T>, maxAttempts: number, delayMs: number, label?: string): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      const context = label ? ` [${label}]` : '';
      console.error(`Retry ${i + 1}/${maxAttempts}${context}: ${(err as Error).message}, retrying in ${delayMs}ms...`);
      await wait(delayMs);
    }
  }
  throw new Error('Retry exhausted');
}

export async function startMockServer(client: Client): Promise<MockServerContext> {
  const registrationToken = process.env['TAKARO_REGISTRATION_TOKEN'];
  const wsUrl = process.env['TAKARO_WS_URL'];

  if (!registrationToken) throw new Error('TAKARO_REGISTRATION_TOKEN is required');
  if (!wsUrl) throw new Error('TAKARO_WS_URL is required');

  const identityToken = `test-${randomUUID()}`;

  const server = await getMockServer({
    mockserver: {
      registrationToken,
      identityToken,
      name: `test-server-${identityToken}`,
    },
    ws: {
      url: wsUrl,
    },
    simulation: {
      autoStart: false,
    },
    population: {
      totalPlayers: 3,
    },
  });

  // Discover the game server in Takaro by identityToken
  const gameServer: GameServerOutputDTO = await retry(
    async () => {
      const result = await client.gameserver.gameServerControllerSearch({
        filters: { identityToken: [identityToken] },
      });
      const found = result.data.data[0];
      if (!found) throw new Error(`Game server with identityToken ${identityToken} not found yet`);
      return found;
    },
    30,
    2000,
    'discover game server',
  );

  // Connect all players (sends player-connected events to Takaro)
  await server.executeConsoleCommand('connectAll');

  // Wait for players to appear in Takaro's playerOnGameserver records
  const players: PlayerOnGameserverOutputDTO[] = await retry(
    async () => {
      const result = await client.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: {
          gameServerId: [gameServer.id],
          online: [true],
        },
      });
      const found = result.data.data;
      if (found.length === 0) throw new Error('No players online yet');
      return found;
    },
    20,
    2000,
    'wait for players',
  );

  return { server, gameServer, players, identityToken };
}

export async function stopMockServer(
  server: MockGameServer,
  client?: Client,
  gameServerId?: string,
): Promise<void> {
  await server.shutdown();
  // Delete the game server record from Takaro to prevent orphan accumulation
  if (client && gameServerId) {
    try {
      await client.gameserver.gameServerControllerRemove(gameServerId);
    } catch (err) {
      console.error(`stopMockServer: failed to delete game server '${gameServerId}':`, err);
    }
  }
  // Disconnect Redis clients opened by the mock server's GameDataHandler.
  // Without this, open Redis connections keep the Node.js event loop alive
  // and the test process never exits.
  await Redis.destroy();
}
