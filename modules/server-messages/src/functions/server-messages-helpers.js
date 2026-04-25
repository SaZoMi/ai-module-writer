import { takaro } from '@takaro/helpers';

export const SM_SEQ_INDEX_KEY = 'sm_seq_index';
export const SM_BAG_KEY = 'sm_bag';
export const SM_CONFIG_HASH_KEY = 'sm_config_hash';

/**
 * Read a module-scoped variable. Returns null if not found.
 */
async function findVariable(gameServerId, moduleId, key) {
  const res = await takaro.variable.variableControllerSearch({
    filters: {
      key: [key],
      gameServerId: [gameServerId],
      moduleId: [moduleId],
    },
  });
  return res.data.data.length > 0 ? res.data.data[0] : null;
}

/**
 * Write a module-scoped variable (upsert).
 * Handles 409 conflict (race condition on concurrent first-write) by reading
 * the winning writer's value and returning it, so callers can continue safely.
 *
 * The return value on a 409 is informational — it contains the winning writer's
 * stored value. Callers that only perform a write (and don't need to read back
 * the stored value) can safely ignore it; the next read will reflect Takaro's
 * state. Callers that need the authoritative value should use it.
 */
async function writeVariable(gameServerId, moduleId, key, value) {
  const existing = await findVariable(gameServerId, moduleId, key);
  const serialized = JSON.stringify(value);
  if (existing) {
    await takaro.variable.variableControllerUpdate(existing.id, { value: serialized });
  } else {
    try {
      await takaro.variable.variableControllerCreate({ key, value: serialized, gameServerId, moduleId });
    } catch (err) {
      // Only treat a 409 Conflict as a concurrent-write race. Any other error propagates.
      if (!err || err.response?.status !== 409) throw err;
      // Another concurrent execution may have created it first (409 conflict).
      // Re-read the winning writer's value and return it so we don't overwrite it.
      const created = await findVariable(gameServerId, moduleId, key);
      if (created) {
        // Return the existing value so the caller can use the winner's state.
        // (Informational — callers that only write and don't need the value can ignore it.)
        return JSON.parse(created.value);
      }
      throw err;
    }
  }
  return null;
}

/**
 * Delete a module-scoped variable. No-op if it doesn't exist or was already deleted.
 */
async function deleteVariable(gameServerId, moduleId, key) {
  const existing = await findVariable(gameServerId, moduleId, key);
  if (!existing) return;
  try {
    await takaro.variable.variableControllerDelete(existing.id);
  } catch (err) {
    // Tolerate 404: another concurrent execution already deleted this variable.
    // "Already deleted" is success for a delete operation.
    if (err && err.response?.status === 404) {
      return;
    }
    throw err;
  }
}

/**
 * Compute a simple fingerprint of the current message list for invalidation.
 * The `order` field is always included so switching between sequential and random
 * is detected as a config change and triggers a state reset.
 *
 * For sequential mode: order-sensitive hash so that reordering messages
 * correctly triggers a state reset (which restarts from index 0).
 *
 * For random mode: canonical (sorted) hash so that cosmetic reordering of
 * messages in the config does NOT reset a mid-cycle bag — only actual
 * text/weight changes matter.
 */
export function computeConfigHash(messages, order) {
  if (order === 'random') {
    // Sort by text then weight for a stable canonical representation.
    // Include `order` so switching from random → sequential is detected.
    const normalized = messages
      .map((m) => ({ text: m.text, weight: m.weight ?? 1 }))
      .sort((a, b) => {
        if (a.text < b.text) return -1;
        if (a.text > b.text) return 1;
        return a.weight - b.weight;
      });
    return JSON.stringify({ order, messages: normalized });
  }
  // Sequential: order matters — keep position-sensitive hash.
  // Include `order` so switching from sequential → random is detected.
  const normalized = messages.map((m) => ({ text: m.text, weight: m.weight ?? 1 }));
  return JSON.stringify({ order, messages: normalized });
}

/**
 * Build a weighted bag of message texts.
 * Each message's text appears (weight) times in the bag.
 * Storing text (not array indices) means a cosmetic reorder of config messages
 * does not corrupt the bag — the same text still refers to the same logical message.
 */
export function buildBag(messages) {
  const bag = [];
  for (let i = 0; i < messages.length; i++) {
    const weight = messages[i].weight ?? 1;
    for (let w = 0; w < weight; w++) {
      bag.push(messages[i].text);
    }
  }
  return bag;
}

/**
 * Fisher-Yates shuffle (in place). Returns the shuffled array.
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ---- Persistent state accessors ----

export async function getConfigHash(gameServerId, moduleId) {
  const v = await findVariable(gameServerId, moduleId, SM_CONFIG_HASH_KEY);
  if (!v) return null;
  // The hash is stored as a plain string via writeVariable (which JSON.stringify-encodes it
  // into a quoted string). Parse once to unwrap the quotes.
  try {
    const parsed = JSON.parse(v.value);
    if (typeof parsed === 'string') return parsed;
    return null;
  } catch (_err) {
    return null;
  }
}

export async function setConfigHash(gameServerId, moduleId, hash) {
  // hash is already a plain string (from computeConfigHash). writeVariable wraps
  // it in JSON.stringify, so it is stored as a single-level JSON-encoded string.
  await writeVariable(gameServerId, moduleId, SM_CONFIG_HASH_KEY, hash);
}

export async function getSeqIndex(gameServerId, moduleId) {
  const v = await findVariable(gameServerId, moduleId, SM_SEQ_INDEX_KEY);
  if (!v) return 0;
  try {
    const val = JSON.parse(v.value);
    return typeof val === 'number' && isFinite(val) ? Math.floor(val) : 0;
  } catch (_err) {
    return 0;
  }
}

export async function setSeqIndex(gameServerId, moduleId, index) {
  await writeVariable(gameServerId, moduleId, SM_SEQ_INDEX_KEY, Math.floor(index));
}

/**
 * bag state: { bag: string[], cursor: number }
 * bag    — array of message texts (weighted, one entry per weight unit)
 * cursor — next position to consume
 *
 * Texts are stored (not indices) so that a cosmetic reorder of config messages
 * does not corrupt the bag — the same text still refers to the same logical message.
 */
export async function getBagState(gameServerId, moduleId) {
  const v = await findVariable(gameServerId, moduleId, SM_BAG_KEY);
  if (!v) return null;
  try {
    const val = JSON.parse(v.value);
    if (!val || !Array.isArray(val.bag) || typeof val.cursor !== 'number') return null;
    return val;
  } catch (_err) {
    return null;
  }
}

export async function setBagState(gameServerId, moduleId, bagState) {
  await writeVariable(gameServerId, moduleId, SM_BAG_KEY, bagState);
}

/**
 * Clear only rotation state (seq index + bag) WITHOUT clearing the config hash.
 * Use this after setConfigHash to avoid deleting the hash you just wrote.
 * Idempotent: 404 on delete is treated as success.
 */
export async function clearRotationState(gameServerId, moduleId) {
  await Promise.all([
    deleteVariable(gameServerId, moduleId, SM_SEQ_INDEX_KEY),
    deleteVariable(gameServerId, moduleId, SM_BAG_KEY),
  ]);
}

