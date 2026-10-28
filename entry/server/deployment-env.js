// Shared host detection: Vercel's env flag is not present on Railway.
// NODE_ENV=production deliberately treats all public container deployments as production.
export function isProductionDeployment(env = process.env) {
  return env.VERCEL_ENV === 'production' ||
    env.NODE_ENV === 'production' ||
    String(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || '').toLowerCase() === 'production';
}

export function requiresSharedStore(env = process.env) {
  // Railway services can be scaled or restarted; local memory is not durable for
  // links and must not be used as a global paid-voice cost gate.
  return Boolean(env.VERCEL || env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID);
}
