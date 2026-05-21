import { serve } from "@hono/node-server";
import { app } from "./hono";
import { db } from "./db";

db.trees.insert({ name: 'Oak', alive: true });
const rows = db.trees.many()

serve({
    fetch: app.fetch,
    port: 3000,
})

for (const row of rows)
    console.dir(row, { depth: null });
