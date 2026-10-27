import { createHandler } from '../server/app.js';

// Sealed links need a shared store on Vercel (UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN). Without one this answers
// 503 links_unavailable instead of keeping links in a memory that serverless instances do not share.
const handle = createHandler();

export default function links(request, response) {
  request.url = '/api/links';
  return handle(request, response);
}
