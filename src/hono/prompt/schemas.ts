import { PROMPT_STATUSES } from '@db/schema';
import { isCallbackUrlAllowed } from '@lib';
import { z } from 'zod';

const clientName = z.string().min(1);

// Identifies a single prompt — used by GET /prompt/get and DELETE /prompt/cancel.
export const PromptKeyQuerySchema = z.object({
  clientName,
  requestId: z.string().min(1)
});

export const ListQuerySchema = z.object({
  clientName,
  status: z.enum(PROMPT_STATUSES).optional()
});

export const PurgeQuerySchema = z.object({
  clientName: clientName.optional(),
  days: z.coerce.number().int().min(1).default(7)
});

export const AddPromptBodySchema = z.object({
  clientName,
  requestId: z.string().min(1),
  callbackUrl: z
    .string()
    .url()
    .refine(isCallbackUrlAllowed, { message: 'callbackUrl is not in the allowlist' })
    .describe('POSTed to after the prompt completes')
    .optional(),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2),
  priority: z.number().int().min(0).describe('Lower value = higher priority (processed first)').optional().default(0),
  overwrite: z.boolean().describe('Replace existing non-in-progress prompt').optional().default(false)
});
