// Vercel serverless entry — re-exports the Express app as the request handler.
// All routes are rewritten here by vercel.json.
import app from "../src/index.js";
export default app;
