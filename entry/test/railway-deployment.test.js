import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isProductionDeployment, requiresSharedStore } from '../server/deployment-env.js';
import { loadVoiceConfig } from '../server/voice.js';
import { chatConfig } from '../server/ai-chat.js';
import { createLinkStoreFromEnv } from '../server/links.js';
import { clientKey } from '../server/app.js';

const base = { MGADI_VOICE_MODE: 'retell', RETELL_API_KEY: 'test-private', RETELL_AGENT_ID_EN: 'agent-test', MGADI_OPERATOR_TOKEN: 'test-operator-token-1234567890' };

test('Railway production gets the same operator restriction as Vercel production', () => {
  assert.equal(isProductionDeployment({ RAILWAY_ENVIRONMENT_NAME: 'production' }), true);
  assert.equal(isProductionDeployment({ NODE_ENV: 'production' }), true);
  assert.equal(isProductionDeployment({ VERCEL_ENV: 'production' }), true);
  assert.equal(isProductionDeployment({ VERCEL_ENV: 'preview' }), false);
  assert.equal(isProductionDeployment({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'staging' }), false);
  assert.equal(loadVoiceConfig({ ...base, RAILWAY_ENVIRONMENT_NAME: 'production' }).operatorEnabled, false);
  assert.equal(loadVoiceConfig({ ...base, NODE_ENV: 'production' }).operatorEnabled, false);
  assert.equal(loadVoiceConfig({ ...base, NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'staging' }).operatorEnabled, true);
  assert.equal(loadVoiceConfig({ ...base, RAILWAY_ENVIRONMENT_NAME: 'production', MGADI_OPERATOR_ALLOW_PRODUCTION: 'yes' }).operatorEnabled, true);
});

test('Railway production does not enable paid chat without explicit readiness', () => {
  const env = { RAILWAY_ENVIRONMENT_NAME: 'production', ANTHROPIC_API_KEY: 'test' };
  assert.equal(chatConfig(env).available, false);
  assert.equal(chatConfig({ ...env, MGADI_AI_PUBLIC_READY: 'yes' }).available, true);
});

test('shared durable quotas and links are required on Railway', () => {
  const env = { RAILWAY_PROJECT_ID: 'project-test', ...base };
  assert.equal(requiresSharedStore(env), true);
  assert.equal(loadVoiceConfig(env).sharedStoreRequired, true);
  assert.equal(createLinkStoreFromEnv(env).sharedRequired, true);
  assert.equal(requiresSharedStore({}), false);
});

test('Railway Dockerfile builds browser assets and starts the existing Node server', () => {
  const docker = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /npm ci/);
  assert.match(docker, /npm run build/);
  assert.match(docker, /NODE_ENV=production/);
  assert.match(docker, /CMD \["node", "server\.js"\]/);
  const ignore = fs.readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\.env\.\*/m);
});

test('Railway public edge client IP is used only when valid edge headers are present', () => {
  const env = { RAILWAY_PROJECT_ID: 'test-project' };
  const socket = { remoteAddress: '10.0.0.3' };
  const edge = { 'x-railway-edge': 'jnb1', 'x-forwarded-proto': 'https', 'x-real-ip': '198.51.100.10' };
  assert.equal(clientKey({ headers: edge, socket }, env), '198.51.100.10');
  assert.equal(clientKey({ headers: { ...edge, 'x-real-ip': 'unsafe' }, socket }, env), '10.0.0.3');
  assert.equal(clientKey({ headers: { 'x-real-ip': '198.51.100.10' }, socket }, env), '10.0.0.3');
  assert.equal(clientKey({ headers: edge, socket }, {}), '10.0.0.3');
});
