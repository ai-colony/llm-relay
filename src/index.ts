import { serve } from "@hono/node-server";
import { app } from "./hono";

serve({
    fetch: app.fetch,
    port: 3000,
})