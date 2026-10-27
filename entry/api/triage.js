import { createHandler } from '../server/app.js';

// First hosted prototype is rules-only. In-memory rate limits are not shared
// across function instances; add distributed abuse controls before paid AI/calls.
const handle = createHandler();

export default function triage(request, response) {
  request.url = '/api/triage';
  return handle(request, response);
}
