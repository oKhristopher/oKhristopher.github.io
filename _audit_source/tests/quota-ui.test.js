import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.cjs', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('daily quota message is shown only for the explicit daily-limit response', () => {
  assert.match(client, /code === 'DAILY_LIMIT_REACHED'/);
  assert.match(client, /code==='DAILY_LIMIT_REACHED'\)saveLocalUsage\(Number\(e\.data\.limit\)\|\|DAILY_LIMIT\)/);
  assert.doesNotMatch(client, /if\(e\.status===429\|\|e\.data\?\.code===['"]DAILY_LIMIT_REACHED['"]\)saveLocalUsage\(DAILY_LIMIT\)/);
});

test('quota refresh runs after chat errors and when returning to the app', () => {
  assert.match(client, /try\{await refreshUsage\(\)\}catch\{\}/);
  assert.match(client, /function syncUsageOnReturn\(\)/);
  assert.match(client, /checkService\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(client, /addEventListener\(['"]focus['"],\s*syncUsageOnReturn/);
  assert.match(client, /addEventListener\(['"]visibilitychange['"]/);
});

test('server computes the daily allowance using Sao Paulo local date', () => {
  assert.match(server, /timeZone:\s*['"]America\/Sao_Paulo['"]/);
  assert.match(server, /usage_date = \$2/);
  assert.match(server, /code:\s*['"]DAILY_LIMIT_REACHED['"]/);
});

test('service worker cache version was advanced to refresh installed PWA assets', () => {
  const match = worker.match(/const CACHE_NAME\s*=\s*['"]palavra-shell-v(\d+)['"]/);
  assert.ok(match, 'service worker should have a versioned shell cache');
  assert.ok(Number(match[1]) >= 6, 'cache version must be newer than the previously deployed v5');
});
