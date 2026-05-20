import { Hono } from 'hono'

export const health = new Hono().get('/', (c) => {
    return c.json({
        success: true,
        message: 'Service is alive',
    })
})