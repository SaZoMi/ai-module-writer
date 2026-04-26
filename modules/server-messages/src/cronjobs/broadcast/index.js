import { data, takaro } from '@takaro/helpers';
import {
  computeConfigHash,
  buildBag,
  shuffle,
  getConfigHash,
  setConfigHash,
  getSeqIndex,
  setSeqIndex,
  getBagState,
  setBagState,
  clearRotationState,
} from './server-messages-helpers.js';

// Placeholders that are intentionally resolved by this module.
// Tokens matching these names that remain in the text after resolution
// (e.g. because the API call failed) should NOT be reported as "unrecognised" —
// the resolveServerName error log already surfaces the failure for operators.
const KNOWN_PLACEHOLDERS = new Set(['playerCount', 'serverName']);

/**
 * Replace {playerCount} placeholder. Unknown placeholders are left unchanged.
 */
function renderPlayerCount(text, playerCount) {
  return text.replace(/\{playerCount\}/g, String(playerCount));
}

/**
 * Resolve {serverName} placeholder via API.
 * On API failure, the placeholder is left in place. The operator can see the
 * reason in the error log emitted below. checkUnknownPlaceholders() uses an
 * allowlist so it will NOT warn about {serverName} a second time.
 */
async function resolveServerName(text, gameServerId) {
  if (!text.includes('{serverName}')) return text;
  try {
    const serverRes = await takaro.gameserver.gameServerControllerGetOne(gameServerId);
    const serverName = serverRes.data.data?.name;
    if (serverName) {
      return text.replace(/\{serverName\}/g, serverName);
    }
    // Name is falsy — leave {serverName} in place
    return text;
  } catch (err) {
    console.error(
      `server-messages: failed to fetch server name, leaving {serverName} placeholder unchanged. Error: ${err}`,
    );
    return text;
  }
}

/**
 * After all substitutions, warn about any remaining tokens that are NOT in the
 * known-placeholder allowlist. Known placeholders that failed to resolve
 * (e.g. {serverName} on API error) are already surfaced by their own error log —
 * re-warning here would produce two contradictory log lines.
 */
function checkUnknownPlaceholders(text) {
  const remaining = text.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
  if (!remaining || remaining.length === 0) return;
  const unknownTokens = remaining
    .map((t) => t.slice(1, -1)) // strip braces to get the name
    .filter((name) => !KNOWN_PLACEHOLDERS.has(name));
  const unique = [...new Set(unknownTokens)].map((name) => `{${name}}`);
  if (unique.length > 0) {
    console.warn(`server-messages: unrecognised placeholders in message text: ${unique.join(', ')}`);
  }
}

/**
 * Render all placeholders in text, resolving known ones and leaving unknown ones intact.
 */
async function renderText(rawText, playerCount, gameServerId) {
  let text = renderPlayerCount(rawText, playerCount);
  text = await resolveServerName(text, gameServerId);
  checkUnknownPlaceholders(text);
  return text;
}

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  const messages = config.messages ?? [];
  const order = config.order ?? 'sequential';

  // Exit quietly when there are no messages configured
  if (messages.length === 0) {
    console.log(
      'server-messages: no messages configured, skipping — add messages in the module config to start broadcasting',
    );
    return;
  }

  // Check online player count — skip tick without advancing state if nobody is online
  const onlineRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
    filters: {
      gameServerId: [gameServerId],
      online: [true],
    },
    limit: 1,
  });
  const onlineCount = onlineRes.data.meta.total;

  if (onlineCount === 0) {
    console.log('server-messages: no players online, skipping tick without advancing state');
    return;
  }

  // Detect config changes and reset state when the message list or weights changed.
  // Write the new hash BEFORE clearing rotation state: any concurrent execution
  // that reads the hash after this point will see the new hash and skip the
  // init/reset path, reducing the window for duplicate resets.
  // NOTE: cronjob scheduling should not double-fire; this module is best-effort on
  // concurrent reads. A full read-modify-write lock on bag/seqIndex would require
  // optimistic-concurrency support not available in this API surface.
  const currentHash = computeConfigHash(messages, order);
  const storedHash = await getConfigHash(gameServerId, moduleId);

  let stateJustReset = false;
  if (storedHash === null) {
    // First run — no previous state exists yet.
    // Write the new hash BEFORE clearing rotation state: any concurrent execution
    // that reads the hash after this point will see the new hash and skip the
    // init path, reducing the duplicate-reset window.
    console.log('server-messages: initializing state');
    await setConfigHash(gameServerId, moduleId, currentHash);
    await clearRotationState(gameServerId, moduleId);
    stateJustReset = true;
  } else if (storedHash !== currentHash) {
    // Real config change detected.
    // Write the new hash first (see above), then clear only the rotation state.
    console.log(
      'server-messages: config changed (messages or order), rotation state reset — restarting rotation from the beginning this tick',
    );
    await setConfigHash(gameServerId, moduleId, currentHash);
    await clearRotationState(gameServerId, moduleId);
    stateJustReset = true;
  }

  // Warn once when weight fields are present but ignored (sequential mode).
  // Only emit this on state-init / config-change to avoid log spam every tick.
  if (order === 'sequential' && stateJustReset && messages.some((m) => (m.weight ?? 1) > 1)) {
    console.warn('server-messages: order=sequential — weight fields on messages are ignored');
  }

  // Warn once on state-init / config-change when duplicate message texts are detected.
  // In random mode, entries with the same text share combined weight and are sent more often.
  // In sequential mode, each copy is sent individually in order.
  if (stateJustReset) {
    const texts = messages.map((m) => m.text);
    if (texts.length !== new Set(texts).size) {
      console.warn(
        'server-messages: duplicate message texts detected. Random mode: duplicates share combined weight (sent more often). Sequential mode: each copy is sent individually.',
      );
    }
  }

  // Resolve the next message index based on rotation mode
  if (order === 'sequential') {
    let index = await getSeqIndex(gameServerId, moduleId);
    // Wrap around if the index is out of range (can happen after a config reset or message list shrink)
    if (index >= messages.length) {
      console.warn(
        `server-messages: sequential index=${index} out of range (messages.length=${messages.length}), resetting to 0`,
      );
      index = 0;
    }
    const messageIndex = index;
    const nextIndex = (index + 1) % messages.length;
    console.log(
      `server-messages: sequential mode, index=${messageIndex}, nextIndex=${nextIndex}, total=${messages.length}`,
    );

    const messageItem = messages[messageIndex];
    const text = await renderText(messageItem.text, onlineCount, gameServerId);
    console.log(`server-messages: sending message index=${messageIndex}: ${text}`);

    // Advance state ONLY after a successful send. If send throws, the exception
    // propagates — the cronjob is marked failed and the next tick retries the
    // same message. This matches the plan invariant: "skip ticks without advancing
    // state when nothing is actually sent."
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: text,
      opts: {},
    });

    // If sendMessage succeeds but this state-write fails, the exception propagates
    // and the cronjob is marked failed. The next tick will resend this message
    // (double-broadcast). This is an inherent trade-off of the "no-advance-on-send-failure"
    // invariant per the plan — a transient storage failure after a successful send is
    // rare but causes a visible duplicate. Delivery-receipt / pending-marker patterns
    // could eliminate this but are deliberately out of scope for v1.
    await setSeqIndex(gameServerId, moduleId, nextIndex);
    console.log(`server-messages: broadcast complete`);
    return;
  }

  // Random: weighted shuffle-bag
  // The bag stores message TEXTS (not array indices) so that a cosmetic reorder of
  // config messages does not corrupt the bag — the same text still refers to the same
  // logical message regardless of its position in the config array.
  let bagState = await getBagState(gameServerId, moduleId);

  // (Re)build bag if we don't have one or the cursor has exhausted it
  if (!bagState || bagState.cursor >= bagState.bag.length) {
    if (bagState && bagState.cursor >= bagState.bag.length) {
      console.log(`server-messages: random mode, bag exhausted — rebuilding`);
    }
    const newBag = shuffle(buildBag(messages));
    bagState = { bag: newBag, cursor: 0 };
    console.log(`server-messages: random mode, built new bag of size ${newBag.length}`);
  }

  let messageText = bagState.bag[bagState.cursor];

  // OOB guard: if the stored text is no longer in the current message list (shouldn't
  // happen post-reset but possible if state is corrupt or messages were removed without
  // a hash change), rebuild the bag and proceed from position 0.
  const currentTexts = new Set(messages.map((m) => m.text));
  if (messageText === undefined || !currentTexts.has(messageText)) {
    console.warn(
      `server-messages: random mode cursor=${bagState.cursor} yielded stale text (not in current message list), rebuilding bag`,
    );
    const newBag = shuffle(buildBag(messages));
    bagState = { bag: newBag, cursor: 0 };
    messageText = bagState.bag[0];
    console.log(`server-messages: random mode, rebuilt bag of size ${newBag.length}`);
  }

  const nextCursor = bagState.cursor + 1;

  // Resolve the current message item by text for rendering and logging
  const messageIndex = messages.findIndex((m) => m.text === messageText);
  console.log(
    `server-messages: random mode, cursor=${bagState.cursor}, messageIndex=${messageIndex}, bagSize=${bagState.bag.length}`,
  );

  const messageItem = messages[messageIndex];
  const text = await renderText(messageItem.text, onlineCount, gameServerId);
  console.log(`server-messages: sending message index=${messageIndex}: ${text}`);

  // Advance state ONLY after a successful send. If send throws, the exception
  // propagates — the cronjob is marked failed and the next tick retries the
  // same message. This matches the plan invariant: "skip ticks without advancing
  // state when nothing is actually sent."
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: text,
    opts: {},
  });

  // If sendMessage succeeds but this state-write fails, the exception propagates
  // and the cronjob is marked failed. The next tick will resend this message
  // (double-broadcast). This is an inherent trade-off of the "no-advance-on-send-failure"
  // invariant per the plan — a transient storage failure after a successful send is
  // rare but causes a visible duplicate. Delivery-receipt / pending-marker patterns
  // could eliminate this but are deliberately out of scope for v1.
  bagState.cursor = nextCursor;
  await setBagState(gameServerId, moduleId, bagState);
  console.log(`server-messages: broadcast complete`);
}

await main();
