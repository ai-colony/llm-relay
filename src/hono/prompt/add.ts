import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

const BodySchema = z.object({
  id: z.string(),
  name: z.string()
});

const ResponseSchema = z.object({
  success: z.boolean(),
  message: z.string()
});
type ResponseSchema = z.infer<typeof ResponseSchema>;

export const add = new Hono().post('/', zValidator('json', BodySchema), (c) => {
  const data = c.req.valid('json');
  return c.json({
    success: true,
    message: `${data.name} is ${data.id}`
  } satisfies ResponseSchema);
});
