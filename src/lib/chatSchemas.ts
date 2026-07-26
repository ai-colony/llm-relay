import { z } from 'zod';

const RelayToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string().describe('JSON-encoded function arguments') })
});

export const RelayMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable().describe('Message text; null for tool-call-only assistant turns').optional(),
  tool_calls: z.array(RelayToolCallSchema).optional(),
  tool_call_id: z.string().describe('Required when role is tool').optional(),
  name: z.string().optional()
});

export const RelayToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown())
  })
});

export const RelayChatRequestSchema = z.object({
  messages: z.array(RelayMessageSchema).min(1).describe('Conversation history in OpenAI message format'),
  tools: z.array(RelayToolSchema).describe('Optional tool/function definitions available to the model').optional(),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .describe('Sampling temperature (0–2). Omit to use the model default.')
    .optional()
});

export type RelayMessage = z.infer<typeof RelayMessageSchema>;
export type RelayTool = z.infer<typeof RelayToolSchema>;
export type RelayChatRequest = z.infer<typeof RelayChatRequestSchema>;
