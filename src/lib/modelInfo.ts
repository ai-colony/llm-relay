import path from 'node:path';

import { config } from './config';
import { logger } from './logger';

export type ModelInfo = { model: string; contextSize: number | undefined };

export type UpstreamConfig = { url: string; model: string; key: string };

export type ModelResolver = {
  getModelInfo: () => Promise<ModelInfo>;
  check: () => Promise<{ ok: boolean; error?: string }>;
};

// Deliberately short and decoupled from config.upstream.timeout so /health fails fast even when
// the configured completion timeout is long.
const HEALTH_CHECK_TIMEOUT_MS = 5000;

// One independently cached resolver per upstream. The config is read through a thunk rather than
// captured up front so a reassigned config (as the tests do) still takes effect.
export const createModelResolver = (component: string, getConfig: () => UpstreamConfig): ModelResolver => {
  let resolvedModelInfoPromise: Promise<ModelInfo> | undefined;
  let resolvedAt = 0;

  const getModelInfo = (): Promise<ModelInfo> => {
    if (resolvedModelInfoPromise && Date.now() - resolvedAt > config.upstream.modelCacheTtlMs)
      resolvedModelInfoPromise = undefined;

    if (!resolvedModelInfoPromise) {
      // Stamped here rather than only after the fetch resolves: while the request is in flight the TTL
      // check above must not consider the cache stale, or every concurrent caller would discard the
      // in-flight promise and fire its own /models request. Re-stamped on success below so the TTL
      // window measures from the resolved value.
      resolvedAt = Date.now();
      resolvedModelInfoPromise = (async () => {
        const { url, model: requestedModel, key } = getConfig();
        const response = await fetch(`${url}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(config.upstream.timeout)
        });
        if (!response.ok) throw new Error(`Models endpoint returned HTTP ${response.status}`);
        const json = (await response.json()) as { data: Array<{ id: string; meta?: { n_ctx?: number } }> };
        const entry = requestedModel ? json.data.find((m) => m.id === requestedModel) : json.data[0];
        if (!entry) throw new Error('No models found' + (requestedModel ? ` with id ${requestedModel}` : ''));
        const contextSize = entry.meta?.n_ctx;
        const model = path.basename(entry.id);
        logger.info({ component, model, contextSize }, 'Using model');
        resolvedAt = Date.now();
        return { model, contextSize };
      })().catch((error: unknown) => {
        resolvedModelInfoPromise = undefined;
        throw error;
      });
    }

    return resolvedModelInfoPromise;
  };

  const check = async (): Promise<{ ok: boolean; error?: string }> => {
    const { url, key } = getConfig();
    let response: Response;
    try {
      response = await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
      });
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  };

  return { getModelInfo, check };
};
