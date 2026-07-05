// Vercel serverless entry — re-exports the Express app as the request handler.
// @vercel/node compiles this TS from source (no separate build step).
import app from "../src/index.js";
export default app;
