'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const appPath = path.resolve('runtime-app/public/app.js');
const workerPath = path.resolve('runtime-app/public/sw.js');

async function main() {
  let app = await fs.readFile(appPath, 'utf8');
  let worker = await fs.readFile(workerPath, 'utf8');

  function replaceExactlyOnce(source, pattern, replacement, label) {
    const matches = source.match(pattern) || [];
    if (matches.length !== 1) {
      throw new Error(`Quota patch aborted: expected one match for ${label}, found ${matches.length}`);
    }
    return source.replace(pattern, replacement);
  }

  // A 429 can mean a short rate-limit window, not that the daily allowance is exhausted.
  const helperStart = app.indexOf('function serverErrorText(e){');
  if (helperStart < 0) throw new Error('Quota patch aborted: serverErrorText(e) was not found');
  const sendStart = app.indexOf('async function sendMessage(', helperStart);
  if (sendStart < 0) throw new Error('Quota patch aborted: async sendMessage() was not found');
  const helperEnd = app.lastIndexOf('}', sendStart);
  if (helperEnd < helperStart) throw new Error('Quota patch aborted: serverErrorText() boundary not found');

  const helper = `function serverErrorText(e){
  const code = e?.data?.code;
  if (code === 'DAILY_LIMIT_REACHED') return 'Você usou as 20 mensagens disponíveis hoje. O limite será renovado à meia-noite, no horário de São Paulo.';
  if (e?.status === 429 || code === 'RATE_LIMITED') return 'Você enviou mensagens em sequência. Aguarde um pouco e tente novamente; esse aviso não significa que seu limite diário acabou.';
  if (code === 'RATE_LIMIT_UNAVAILABLE' || code === 'RATE_LIMIT_UNAVAILABLE') return 'Não consegui verificar o limite agora. Confira a conexão e tente novamente em instantes.';
  if (e.message === 'SERVER_NOT_CONFIGURED') return 'A conexão segura com a IA ainda não foi configurada. A navegação bíblica e os favoritos continuam disponíveis.';
  if (/Failed to fetch|NetworkError|Load failed|aborted/i.test(e.message)) return 'Não consegui alcançar o serviço. Confira a conexão com a internet e tente novamente mais tarde. Nenhum versículo foi inventado.';
  return 'Não consegui concluir a busca agora. Nenhuma passagem foi apresentada sem confirmação da fonte bíblica.';
}`;

  app = app.slice(0, helperStart) + helper + app.slice(helperEnd + 1);

  // Only the explicit daily-quota response should zero out the local quota.
  app = replaceExactlyOnce(
    app,
    /if\(e\.status===429\|\|e\.data\?\.code===['"]DAILY_LIMIT_REACHED['"]\)saveLocalUsage\(DAILY_LIMIT\);/,
    "if(e?.data?.code==='DAILY_LIMIT_REACHED')saveLocalUsage(Number(e.data.limit)||DAILY_LIMIT);",
    'daily-limit error handling'
  );

  // Always ask the server again after an error so a stale local counter cannot persist.
  app = replaceExactlyOnce(
    app,
    /if\(e\.message!==['"]SERVER_NOT_CONFIGURED['"]&&e\.status!==429\)\{try\{await refreshUsage\(\)\}catch\{\}\}/,
    'try{await refreshUsage()}catch{}',
    'usage refresh after a failed chat request'
  );

  // Sync quota when the user returns to an existing tab, including after midnight.
  if (!app.includes('function syncUsageOnReturn()')) {
    app = replaceExactlyOnce(
      app,
      /setInterval\(checkDailyRollover,60000\);/,
      `let lastUsageSyncAt = 0;
function syncUsageOnReturn(){
  if (document.visibilityState && document.visibilityState !== 'visible') return;
  if (Date.now() - lastUsageSyncAt < 5000) return;
  lastUsageSyncAt = Date.now();
  refreshUsage().catch(() => {});
}
window.addEventListener('focus', syncUsageOnReturn, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncUsageOnReturn(); });
setInterval(checkDailyRollover,60000);`,
      'daily rollover synchronization hook'
    );
  }

  // Force installed PWAs to discard the previous cached UI after this release.
  const cacheMatch = worker.match(/const CACHE_NAME\s*=\s*['"]palavra-shell-v(\d+)['"]/);
  if (!cacheMatch) throw new Error('Quota patch aborted: service worker cache version not found');
  const newVersion = Number(cacheMatch[1]) + 1;
  worker = worker.replace(cacheMatch[0], `const CACHE_NAME = 'palavra-shell-v${newVersion}'`);

  await fs.writeFile(appPath, app);
  await fs.writeFile(workerPath, worker);
  console.log(`Quota UI patch applied; PWA cache version is v${newVersion}.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
