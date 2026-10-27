import { createHandler } from '../../server/app.js';

// Voice stays off unless MGADI_VOICE_MODE and the Retell variables are set in the Vercel project settings.
const handle = createHandler();

export default function voiceSession(request, response) {
  request.url = '/api/voice/session';
  return handle(request, response);
}
