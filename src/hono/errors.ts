import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Single shape for every error response the relay emits: { success: false, error, ...extra }.
export const jsonError = (
  c: Context,
  status: ContentfulStatusCode,
  error: string,
  extra: Record<string, unknown> = {}
) => c.json({ success: false, error, ...extra }, status);
