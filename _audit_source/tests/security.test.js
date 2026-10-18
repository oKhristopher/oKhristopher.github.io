import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../server.cjs', import.meta.url), 'utf8');
const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('queries SQL keep user-controlled values in parameters', () => {
  assert.match(server, /SELECT message_count FROM daily_usage WHERE installation_hash = \$1 AND usage_date = \$2/);
  assert.match(server, /VALUES \(\$1, \$2, 1\)[\s\S]*?RETURNING message_count/);
  assert.match(server, /installation_hash = \$1 AND usage_date = \$2/);
  assert.doesNotMatch(server, /SELECT[\s\S]{0,200}\$\{(?:message|body|id)\}/i);
});

test('server does not store passwords or add upload/login endpoints', () => {
  assert.doesNotMatch(server, /CREATE TABLE[\s\S]{0,600}\bpassword\b/i);
  assert.doesNotMatch(server, /url\.pathname\s*===?\s*['"]\/api\/(?:login|upload|register)['"]/i);
});

test('anonymous session cookie is signed and protected from JavaScript', () => {
  assert.match(server, /createHmac\('sha256', salt\)/);
  assert.match(server, /timingSafeEqual/);
  assert.match(server, /HttpOnly; SameSite=/);
  assert.match(server, /const secure = process\.env\.NODE_ENV === 'production'.*'; Secure'/);
  assert.match(server, /const id = sessionId\(req, res\)|const id=sessionId\(req,res\)/);
  assert.doesNotMatch(server, /body\.installationId\s*[,=:]/);
});

test('Origin checks and allow-listed CORS are present without a wildcard', () => {
  assert.match(server, /function originAllowed/);
  assert.match(server, /origin === 'null'/);
  assert.match(server, /ALLOWED_ORIGINS\.has/);
  assert.match(server, /Access-Control-Allow-Origin/);
  assert.match(server, /Access-Control-Allow-Credentials/);
  assert.doesNotMatch(server, /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/);
});

test('rate limit returns 429 and Retry-After for chat and API traffic', () => {
  assert.match(server, /chat: \{ limit: 8, windowMs: 60000 \}/);
  assert.match(server, /chatSession: \{ limit: 6, windowMs: 60000 \}/);
  assert.match(server, /'Retry-After'/);
  assert.match(server, /json\(res, 429/);
});

test('input bodies and conversation context have bounded lengths and types', () => {
  assert.match(server, /MAX_MESSAGE_LENGTH = 700/);
  assert.match(server, /application.*json/);
  assert.match(server, /MAX_CONTEXT_TURNS = 4/);
  assert.match(server, /byteCount > maxBytes/);
  assert.match(server, /typeof body\.message !== 'string'/);
  assert.match(html, /maxlength="700"/i);
  assert.match(client, /pending\)return/);
  assert.match(client, /SERVER_BASE/);
});

test('outbound requests are constrained to approved HTTPS hosts and cannot follow redirects', () => {
  assert.match(server, /parsedUrl\.protocol !== 'https:'/);
  assert.match(server, /UPSTREAM_HOSTS\.has\(parsedUrl\.hostname\)/);
  assert.match(server, /redirect:'error'/);
  assert.match(server, /'x-goog-api-key':process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(server, /generateContent\?key=/);
});

test('errors and health endpoint do not expose server configuration', () => {
  assert.match(server, /ready: Boolean\(databaseReady && process\.env\.GEMINI_API_KEY && process\.env\.ID_SALT\)/);
  assert.match(server, /Erro interno do servidor/);
  assert.doesNotMatch(client + html + config, /GEMINI_API_KEY|DATABASE_URL|ID_SALT|AIza[0-9A-Za-z_-]{20,}/);
});

test('security headers and service-worker cache invalidation are maintained', () => {
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /X-Frame-Options/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /Strict-Transport-Security/);
  assert.match(server, /rejectUnauthorized: process\.env\.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'/);
  assert.match(worker, /const CACHE_NAME\s*=\s*['"]palavra-shell-v\d+['"]/);
  assert.match(worker, /keys\.filter\(k=>[\s\S]{0,100}k!==CACHE_NAME/);
});
test('persistent limiter repairs its unique database key before serving requests', () => {
  assert.match(server, /ALTER TABLE request_rate_limits ADD COLUMN IF NOT EXISTS key_hash CHAR\(64\)/);
  assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_request_rate_limits_identity ON request_rate_limits \(key_hash, window_start, window_seconds\)/);
  assert.match(server, /ON CONFLICT \(key_hash, window_start, window_seconds\) DO UPDATE/);
  assert.match(server, /console\.error\('Limitador persistente indisponível:', error\.code \|\| error\.name \|\| 'DatabaseError'\)/);
});
