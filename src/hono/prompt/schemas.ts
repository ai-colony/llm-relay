import { z } from 'zod';

export const QuerySchema = z.object({
  clientName: z.string(),
  requestId: z.string().min(1)
});
