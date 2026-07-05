// Vercel serverless entry — re-exports the compiled Express app as the handler.
// Imports the built JS (dist/) produced by the `vercel-build` step so Vercel's
// bundler resolves it cleanly and traces the Prisma engine from node_modules.
import app from "../dist/index.js";
export default app;
