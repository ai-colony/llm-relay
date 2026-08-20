import { createHmac } from 'node:crypto';

import { config } from './config';
import { logger } from './logger';
import { incCounter } from './metrics';

const CALLBACK_TIMEOUT_MS = 10_000;

// Exponential backoff, capped so a permanently sick upstream is still retried once a minute.
export const computeNextRetryAt = (attempt: number): Date =>
  new Date(Date.now() + Math.min(2 ** attempt * 1000, 60_000));

// Only network-shaped failures are worth retrying. An upstream rejecting the request itself (bad
// input, oversized batch) will reject it identically every time, so it goes terminal immediately.
export const isTransientError = (error: unknown, depth = 0): boolean => {
  if (!(error instanceof Error) || depth > 5) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === 'AbortError' ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    isTransientError(error.cause, depth + 1)
  );
};

export const buildCallbackHeaders = (body: string): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.callback.hmacSecret) {
    const sig = createHmac('sha256', config.callback.hmacSecret).update(body).digest('hex');
    headers['X-LLM-Relay-Signature'] = `hmac-sha256=${sig}`;
  }
  return headers;
};

// Shared by every job queue that delivers results out-of-band. Returns whether the receiver accepted
// it; marking the row delivered is the caller's job, since only it knows which table to touch.
export const deliverJobCallback = async ({
  url,
  body,
  logContext
}: {
  url: string;
  body: string;
  logContext: Record<string, unknown>;
}): Promise<boolean> => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      method: 'POST',
      headers: buildCallbackHeaders(body),
      body
    });
    if (!response.ok) throw new Error(`Callback endpoint returned HTTP ${response.status}`);
    incCounter('callback_deliveries_total', 'Total callback delivery attempts', { result: 'success' });
    logger.info(logContext, 'Callback sent');
    return true;
  } catch (error) {
    incCounter('callback_deliveries_total', 'Total callback delivery attempts', { result: 'failure' });
    logger.error({ ...logContext, error }, 'Callback failed');
    return false;
  }
};
