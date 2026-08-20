import { EMBEDDING_STATUSES, ENCODING_FORMATS } from '@db/schema';
import { isCallbackUrlAllowed } from '@lib';
import { z } from 'zod';

const clientName = z.string().min(1);

// A single string or a batch. Left untransformed so z.toJSONSchema keeps documenting both shapes;
// toInputArray does the normalising at the route boundary instead.
const input = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .describe('Text to embed — one string, or an array to embed as a batch');

export const toInputArray = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value]);

const encodingFormat = z
  .enum(ENCODING_FORMATS)
  .describe("'float' returns number arrays (drop-in for pgvector); 'base64' returns float32 strings, ~4x smaller");

// Identifies a single embedding job — used by DELETE /embedding/cancel.
export const EmbeddingKeyQuerySchema = z.object({
  clientName,
  requestId: z.string().min(1)
});

// GET may re-encode on the way out; without the parameter the job's stored format is used.
export const GetEmbeddingQuerySchema = EmbeddingKeyQuerySchema.extend({
  encodingFormat: encodingFormat.optional()
});

export const ListQuerySchema = z.object({
  clientName,
  status: z.enum(EMBEDDING_STATUSES).optional()
});

export const PurgeQuerySchema = z.object({
  clientName: clientName.optional(),
  days: z.coerce.number().int().min(1).default(7)
});

export const AddEmbeddingBodySchema = z.object({
  clientName,
  requestId: z.string().min(1),
  callbackUrl: z
    .string()
    .url()
    .refine(isCallbackUrlAllowed, { message: 'callbackUrl is not in the allowlist' })
    .describe('POSTed to after the embedding completes')
    .optional(),
  input,
  encodingFormat: encodingFormat.optional().default('float'),
  priority: z.number().int().min(0).describe('Lower value = higher priority (processed first)').optional().default(0),
  overwrite: z.boolean().describe('Replace existing non-in-progress embedding').optional().default(false)
});

export const RunEmbeddingBodySchema = z.object({
  input,
  encodingFormat: encodingFormat.optional().default('float')
});
