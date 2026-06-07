import { z } from 'zod';

export const QuerySchema = z.object({
  clientName: z.string(),
  requestId: z.coerce.number().int().positive()
});
