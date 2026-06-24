import { z } from 'zod';

const RelayToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() })
});

export const RelayMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable().optional(),
  tool_calls: z.array(RelayToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
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
  messages: z.array(RelayMessageSchema).min(1),
  tools: z.array(RelayToolSchema).optional(),
  temperature: z.number().min(0).max(2).optional()
});
