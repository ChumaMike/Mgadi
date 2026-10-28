// Shared host detection: a Railway staging container runs NODE_ENV=production,
// but must keep the staging-only operator test path available for verification.
export function isProductionDeployment(env = process.env) {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT;
  if (railwayEnvironment) return String(railwayEnvironment).toLowerCase() === 'production';
  return env.NODE_ENV === 'production';
}

export function requiresSharedStore(env = process.env) {
  // Railway services restart and may scale; local memory is not durable for
  // responder links and is not a safe shared paid-voice cost gate.
  return Boolean(env.VERCEL || env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID);
}
