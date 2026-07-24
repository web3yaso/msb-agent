import { serve } from "@hono/node-server";

import { createApp } from "./http/index.js";

const app = await createApp();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

serve({
  fetch: app.fetch,
  port,
});
