import { createHandler } from '../server/app.js';
// All AI credentials and safety limits stay server-side. No provider key reaches the browser.
const handle = createHandler();
export default function aiChat(req,res) { req.url = '/api/ai-chat'; return handle(req,res); }
