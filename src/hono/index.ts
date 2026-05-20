import { Hono } from 'hono'
import { health } from './health'
import { prompt } from './prompt'

export const app =
    new Hono()
        .route('/health', health)
        .route('/prompt', prompt)
