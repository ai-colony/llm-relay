import { z } from 'zod';

export const QuerySchema = z.object({
  clientName: z.string().min(1),
  requestId: z.string().min(1)
});
