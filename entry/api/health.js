import { createHandler } from '../server/app.js';

const handle = createHandler();

export default function health(request, response) {
  request.url = '/api/health';
  return handle(request, response);
}
