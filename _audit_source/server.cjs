'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 10000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const BIBLE_API_BASE = 'https://abibliadigital.api.br/api/';
const DAILY_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 700;
const MAX_CONTEXT_TURNS = 4;
const SESSION_COOKIE = 'pv_session';
const SESSION_MAX_AGE = 31536000;
const ALLOWED_ORIGINS = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => {
  try { return new URL(value.trim()).origin; } catch { return ''; }
}).filter(Boolean));
const UPSTREAM_HOSTS = new Set(['generativelanguage.googleapis.com', 'abibliadigital.api.br']);
const RATE_LIMITS = new Map();
const RATE_POLICIES = {
  api: { limit: 120, windowMs: 60000 },
  chat: { limit: 8, windowMs: 60000 },
  chatSession: { limit: 6, windowMs: 60000 },
  bible: { limit: 90, windowMs: 60000 }
};
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const THEMES = ['anxiety','strength','gratitude','peace','hope','sadness','fear','loneliness','forgiveness','patience','love','decision','grief','family','other'];
const THEME_LABELS = {
  anxiety:'Ansiedade', strength:'Força', gratitude:'Gratidão', peace:'Paz', hope:'Esperança', sadness:'Tristeza',
  fear:'Medo', loneliness:'Solidão', forgiveness:'Perdão', patience:'Paciência', love:'Amor', decision:'Decisões',
  grief:'Luto', family:'Família', other:'Tema não identificado'
};
const PASSAGES = {
  anxiety:{abbr:'1pe',bookName:'1 Pedro',chapter:5,verseNumber:7},
  strength:{abbr:'fp',bookName:'Filipenses',chapter:4,verseNumber:13},
  gratitude:{abbr:'1ts',bookName:'1 Tessalonicenses',chapter:5,verseNumber:18},
  peace:{abbr:'jo',bookName:'João',chapter:14,verseNumber:27},
  hope:{abbr:'rm',bookName:'Romanos',chapter:15,verseNumber:13},
  sadness:{abbr:'sl',bookName:'Salmos',chapter:34,verseNumber:18},
  fear:{abbr:'is',bookName:'Isaías',chapter:41,verseNumber:10},
  loneliness:{abbr:'sl',bookName:'Salmos',chapter:23,verseNumber:4},
  forgiveness:{abbr:'ef',bookName:'Efésios',chapter:4,verseNumber:32},
  patience:{abbr:'tg',bookName:'Tiago',chapter:1,verseNumber:4},
  love:{abbr:'1co',bookName:'1 Coríntios',chapter:13,verseNumber:4},
  decision:{abbr:'pv',bookName:'Provérbios',chapter:3,verseNumber:5},
  grief:{abbr:'mt',bookName:'Mateus',chapter:5,verseNumber:4},
  family:{abbr:'js',bookName:'Josué',chapter:24,verseNumber:15}
};
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  max: 5,
  connectionTimeoutMillis: 10000
}) : null;
let databaseReady = false;
let databaseError = null;

function securityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store'
  };
  if (process.env.NODE_ENV === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}
function json(res, status, value, headers={}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...securityHeaders(), 'Content-Type':'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function brazilDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validInstallId(s) { return typeof s === 'string' && /^[a-zA-Z0-9_-]{12,100}$/.test(s); }
function hashId(id) {
  const salt = process.env.ID_SALT;
  if (!salt) throw new Error('ID_SALT is not configured');
  return crypto.createHash('sha256').update(`${salt}:${id}`).digest('hex');
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const sameOriginHost = parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase()
      && (process.env.NODE_ENV !== 'production' || parsed.protocol === 'https:');
    return sameOriginHost || ALLOWED_ORIGINS.has(parsed.origin);
  } catch { return false; }
}
function applyCors(req, res) {
  if (!originAllowed(req)) return false;
  if (req.headers.origin) {
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', new URL(req.headers.origin).origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  return true;
}
function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  const address = forwarded.length ? forwarded[forwarded.length - 1] : (req.socket?.remoteAddress || 'unknown');
  return crypto.createHash('sha256').update(address).digest('hex');
}
function rateLimit(req, res, bucket, identity = '') {
  const policy = RATE_POLICIES[bucket];
  if (!policy) return true;
  const now = Date.now();
  const key = `${bucket}:${clientKey(req)}:${identity ? crypto.createHash('sha256').update(identity).digest('hex') : ''}`;
  let entry = RATE_LIMITS.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + policy.windowMs };
    RATE_LIMITS.set(key, entry);
  }
  if (entry.count >= policy.limit) {
    json(res, 429, { error: 'Muitas solicitações. Aguarde um momento e tente novamente.', code: 'RATE_LIMITED' }, {
      'Retry-After': String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000)))
    });
    return false;
  }
  entry.count += 1;
  if (RATE_LIMITS.size > 10000) {
    for (const [storedKey, value] of RATE_LIMITS) if (now >= value.resetAt) RATE_LIMITS.delete(storedKey);
    if (RATE_LIMITS.size > 20000) RATE_LIMITS.clear();
  }
  return true;
}
function sessionId(req, res) {
  const salt = process.env.ID_SALT;
  if (!salt) throw new Error('ID_SALT is not configured');
  const cookieHeader = String(req.headers.cookie || '');
  const pair = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(SESSION_COOKIE + '='));
  const token = pair ? pair.slice(SESSION_COOKIE.length + 1) : '';
  const [id, expiresText, signature] = token.split('.');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const parsedExpiry = Number(expiresText);
  let valid = false;
  if (/^[A-Za-z0-9_-]{40,50}$/.test(id || '')
      && Number.isSafeInteger(parsedExpiry)
      && parsedExpiry > nowSeconds
      && parsedExpiry <= nowSeconds + SESSION_MAX_AGE + 60
      && /^[a-f0-9]{64}$/i.test(signature || '')) {
    const expected = crypto.createHmac('sha256', salt).update(\`\${id}.\${parsedExpiry}\`).digest();
    const actual = Buffer.from(signature, 'hex');
    valid = actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
  }
  const value = valid ? id : crypto.randomBytes(32).toString('base64url');
  const expiresAt = valid ? parsedExpiry : nowSeconds + SESSION_MAX_AGE;
  const signed = crypto.createHmac('sha256', salt).update(\`\${value}.\${expiresAt}\`).digest('hex');
  let crossOriginAllowed = false;
  try {
    crossOriginAllowed = Boolean(req.headers.origin)
      && new URL(req.headers.origin).host.toLowerCase() !== String(req.headers.host || '').toLowerCase()
      && ALLOWED_ORIGINS.has(new URL(req.headers.origin).origin);
  } catch { /* Origin is validated before the API handler. */ }
  const secure = process.env.NODE_ENV === 'production' || crossOriginAllowed ? '; Secure' : '';
  const sameSite = crossOriginAllowed ? 'None' : 'Strict';
  const maxAge = Math.max(0, expiresAt - nowSeconds);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${value}.${expiresAt}.${signed}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`);
  return value;
}
function cleanUserText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}
async function initDatabase() {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_usage (
    installation_hash CHAR(64) NOT NULL,
    usage_date DATE NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0 AND message_count <= ${DAILY_LIMIT}),
    PRIMARY KEY (installation_hash, usage_date)
  )`);
  databaseReady = true;
}
async function currentUsage(id) {
  const hash = hashId(id);
  const result = await pool.query('SELECT message_count FROM daily_usage WHERE installation_hash = $1 AND usage_date = $2', [hash, brazilDate()]);
  const used = Math.min(DAILY_LIMIT, Math.max(0, Number(result.rows[0]?.message_count || 0)));
  return { used, remaining: DAILY_LIMIT - used, limit: DAILY_LIMIT, date: brazilDate() };
}
async function reserveUsage(id) {
  const hash = hashId(id), date = brazilDate();
  const result = await pool.query(`INSERT INTO daily_usage (installation_hash, usage_date, message_count)
    VALUES ($1, $2, 1)
    ON CONFLICT (installation_hash, usage_date) DO UPDATE
      SET message_count = daily_usage.message_count + 1
      WHERE daily_usage.message_count < ${DAILY_LIMIT}
    RETURNING message_count`, [hash, date]);
  if (!result.rows.length) return null;
  return { used:Number(result.rows[0].message_count), remaining:DAILY_LIMIT-Number(result.rows[0].message_count), limit:DAILY_LIMIT, date, hash };
}
async function releaseUsage(reservation) {
  if (!reservation?.hash) return;
  await pool.query('UPDATE daily_usage SET message_count = GREATEST(0, message_count - 1) WHERE installation_hash = $1 AND usage_date = $2', [reservation.hash, reservation.date]);
}
async function requestJson(url, options={}) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || !UPSTREAM_HOSTS.has(parsedUrl.hostname)) throw new Error('Upstream host not allowed');
  const response = await fetch(parsedUrl, { ...options, redirect:'error', signal:AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  return data;
}
async function interpretSituation(message, context) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const systemText = `Você é a presença acolhedora do Palavra Viva. Seu papel é conversar de forma natural, atenta e contínua, entendendo a pessoa pelo que ela escreve. Não aja como um formulário que apenas classifica temas. Responda em português brasileiro, com humanidade, gentileza e naturalidade.\n\nTemas permitidos: ${THEMES.join(', ')}.\n\nCOMO CONVERSAR:\n- Leia o histórico da conversa: ele contém mensagens da pessoa e respostas anteriores do Palavra Viva. Use-o para manter o fio da conversa, lembrar o assunto que a pessoa já compartilhou e não fazê-la repetir tudo.\n- Responda primeiro ao que a pessoa acabou de dizer. Mostre que compreendeu detalhes reais da mensagem; não repita fórmulas como “sinto muito que esteja passando por isso” em toda resposta.\n- Se houver uma situação emocional concreta, responda com 2 a 4 frases empáticas, específicas e acolhedoras. Quando for natural, termine com uma pergunta aberta e simples para a conversa continuar. Não faça pergunta genérica automaticamente em todas as respostas.\n- Se a mensagem for uma saudação, agradecimento, resposta curta ou continuação social — por exemplo, “oi”, “olá”, “obrigado”, “entendi”, “sim”, “não sei” — converse normalmente. Use o histórico para responder de forma coerente: se a pessoa já falou da ansiedade e depois disser “oi” ou “não sei”, acolha e retome esse assunto delicadamente, sem tratá-la como um usuário novo.\n- Em saudações ou mensagens curtas sem uma nova situação emocional clara, escolha o tema “other”, mas dê uma resposta humana e contextualizada; não diga que precisa identificar um tema, não peça para “tentar outro tema” e não force um versículo em cada fala.\n- Escolha um tema diferente de “other” quando a mensagem atual ou o contexto recente justificarem uma passagem bíblica relevante. Um novo detalhe sobre o mesmo sentimento pode manter o tema anterior, se isso ajudar a conversa.\n- Em “connection”, escreva uma frase curta e delicada explicando como a passagem real selecionada pode dialogar com o que a pessoa contou. Não cite texto bíblico, referência ou promessa dentro de response ou connection.\n- Não invente versículos, referências, capítulos, promessas ou fatos. A passagem será buscada separadamente numa fonte bíblica real e só será exibida se a fonte confirmar o texto.\n- Não responda a perguntas teológicas/doutrinárias nem explique doutrinas. Se perguntarem isso, explique com respeito que o app é um espaço de reflexão sobre sentimentos e experiências e pergunte, se apropriado, o que essa questão desperta na pessoa.\n- Não diagnostique, não julgue nem culpe a pessoa pelo sofrimento. Nunca recomende abandonar cuidados profissionais; se houver risco imediato de autoagressão, incentive ajuda humana urgente e serviços locais de emergência.\n\nRetorne somente JSON com as propriedades theme, response e connection. response deve ser uma resposta conversacional que a pessoa receberia diretamente, não uma descrição do que a IA fez. connection deve ser curta; se theme for “other”, connection pode ser string vazia.`;
  const payload = {
    systemInstruction:{parts:[{text:systemText}]},
    contents:[{role:'user',parts:[{text:`Mensagens anteriores recentes da pessoa, apenas para contexto:
${context.map((turn,i)=>`${i+1}. Pessoa: ${turn.user}\n   Palavra Viva: ${turn.assistant || '(sem resposta anterior registrada)'}`).join('\n')}

Mensagem atual:
${message}`}] }],
    generationConfig:{temperature:0.35,maxOutputTokens:220,responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{theme:{type:'STRING',enum:THEMES},response:{type:'STRING'},connection:{type:'STRING'}},required:['theme','response','connection']}}
  };
  const data = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify(payload)
  });
  const raw = data?.candidates?.[0]?.content?.parts?.map(p=>p.text || '').join('').trim();
  if (!raw) throw new Error('Interpretação vazia');
  const parsed = JSON.parse(raw);
  const theme = String(parsed.theme || 'other').toLowerCase();
  if (!THEMES.includes(theme)) throw new Error('Tema fora da lista permitida');
  const response = String(parsed.response || '').trim().slice(0,900);
  const connection = String(parsed.connection || '').trim().slice(0,360);
  if (!response) throw new Error('Resposta acolhedora vazia');
  return {theme,response,connection};
}
async function retrieveVerse(ref) {
  const data = await requestJson(`${BIBLE_API_BASE}verses/nvi/${encodeURIComponent(ref.abbr)}/${ref.chapter}/${ref.verseNumber}`, { headers:{Accept:'application/json'} });
  if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error('Texto bíblico não confirmado');
  const bookName = data.book?.name || ref.bookName;
  const chapter = typeof data.chapter === 'object' ? (data.chapter.number || ref.chapter) : (data.chapter || ref.chapter);
  const verseNumber = Number(data.number || ref.verseNumber);
  return { bookName, chapter:Number(chapter), verseNumber, version:'NVI', text:data.text.trim(), reference:`${bookName} ${chapter}:${verseNumber} · NVI` };
}
async function readBody(req, maxBytes=12000) {
  let body = '';
  let byteCount = 0;
  for await (const chunk of req) {
    byteCount += Buffer.byteLength(chunk);
    if (byteCount > maxBytes) throw Object.assign(new Error('Corpo da requisição muito grande.'), { status: 413 });
    body += chunk;
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('Corpo JSON inválido.'), { status: 400 }); }
}
async function handleBible(req, res, url) {
  if (req.method !== 'GET') return json(res,405,{error:'Método não permitido'});
  const rest = url.pathname.replace(/^\/api\/bible\/?/, '');
  let upstreamPath='';
  if (rest === 'books' || /^books\/[a-z0-9-]+$/.test(rest)) upstreamPath=rest;
  else {
    const match=rest.match(/^verses\/(nvi|nvt|ntlh|acf|aa|as21)\/([a-z0-9]+)\/(\d{1,3})(?:\/(\d{1,3}))?$/);
    if(!match) return json(res,400,{error:'Caminho bíblico inválido'});
    const chapter=Number(match[3]), verse=match[4]?Number(match[4]):null;
    if(chapter<1 || chapter>200 || (verse!==null && (verse<1 || verse>200))) return json(res,400,{error:'Capítulo ou versículo inválido'});
    upstreamPath=`verses/${match[1]}/${match[2]}/${chapter}${verse?'/'+verse:''}`;
  }
  try {
    const response=await fetch(BIBLE_API_BASE+upstreamPath,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
    const payload=await response.text();
    res.writeHead(response.status,{...securityHeaders(),'Content-Type':response.headers.get('content-type')||'application/json; charset=utf-8','Cache-Control':'public, max-age=300'});res.end(payload);
  } catch { json(res,502,{error:'Não foi possível conectar à fonte bíblica agora.'}); }
}
async function api(req,res,url) {
  if (url.pathname.startsWith('/api/')) {
    if (!applyCors(req, res)) return json(res, 403, { error: 'Origem não permitida.' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...securityHeaders(),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600'
      });
      return res.end();
    }
    if (!rateLimit(req, res, 'api')) return;
    if (url.pathname.startsWith('/api/bible') && !rateLimit(req, res, 'bible')) return;
    if (url.pathname === '/api/chat' && req.method === 'POST' && !rateLimit(req, res, 'chat')) return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, ready: Boolean(databaseReady && process.env.GEMINI_API_KEY && process.env.ID_SALT) });
  }
  if (url.pathname === '/api/bible' || url.pathname.startsWith('/api/bible/')) return handleBible(req, res, url);
  if (req.method === 'GET' && url.pathname === '/api/usage') {
    if (!databaseReady || !process.env.ID_SALT) return json(res, 503, { error: 'Serviço indisponível no momento.' });
    try {
      const id = sessionId(req, res);
      return json(res, 200, { ok: true, ...await currentUsage(id) });
    } catch {
      return json(res, 503, { error: 'Não foi possível consultar o limite diário.' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    if (!databaseReady || !process.env.GEMINI_API_KEY || !process.env.ID_SALT) return json(res, 503, { error: 'SERVER_NOT_CONFIGURED' });
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) return json(res, 415, { error: 'Envie os dados em formato JSON.' });
    let body;
    try { body = await readBody(req); } catch (error) { return json(res, error.status || 400, { error: error.message }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Corpo JSON inválido.' });
    if (typeof body.message !== 'string' || body.message.length > MAX_MESSAGE_LENGTH) return json(res, 400, { error: 'A mensagem deve ter entre 1 e 700 caracteres.' });
    const message = cleanUserText(body.message, MAX_MESSAGE_LENGTH);
    if (!message) return json(res, 400, { error: 'A mensagem deve ter entre 1 e 700 caracteres.' });
    const context = Array.isArray(body.context) ? body.context.slice(-MAX_CONTEXT_TURNS).map(turn => {
      if (!turn || typeof turn !== 'object' || Array.isArray(turn) || typeof turn.user !== 'string') return null;
      const user = cleanUserText(turn.user, 250);
      const assistantRaw = typeof turn.assistant === 'string' ? turn.assistant : (typeof turn.reply === 'string' ? turn.reply : '');
      const assistant = cleanUserText(assistantRaw, 350);
      return user ? { user, assistant } : null;
    }).filter(Boolean) : [];
    let id;
    try {
      id = sessionId(req, res);
      if (!rateLimit(req, res, 'chatSession', id)) return;
    } catch {
      return json(res, 503, { error: 'Serviço indisponível no momento.' });
    }
    let reservation;
    try { reservation = await reserveUsage(id); }
    catch { return json(res, 503, { error: 'Não foi possível verificar o limite diário.' }); }
    if (!reservation) return json(res, 429, { error: 'Você atingiu o limite diário de 20 mensagens.', code: 'DAILY_LIMIT_REACHED', limit: DAILY_LIMIT, remaining: 0 });
    try {
      const interpretation = await interpretSituation(message, context);
      const { theme, response, connection } = interpretation;
      if (theme === 'other') return json(res, 200, { ok: true, theme, themeLabel: THEME_LABELS[theme], response, used: reservation.used, remaining: reservation.remaining, limit: DAILY_LIMIT });
      const ref = PASSAGES[theme];
      if (!ref) throw new Error('Tema sem referência permitida');
      const passage = await retrieveVerse(ref);
      return json(res, 200, { ok: true, theme, themeLabel: THEME_LABELS[theme], response, connection, passage, used: reservation.used, remaining: reservation.remaining, limit: DAILY_LIMIT });
    } catch (error) {
      await releaseUsage(reservation).catch(() => {});
      console.error('Falha ao classificar ou confirmar passagem:', error.name || 'Error');
      return json(res, 502, { error: 'Não foi possível confirmar uma passagem agora. Tente novamente mais tarde.', code: 'PASSAGE_UNAVAILABLE' });
    }
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Rota não encontrada.' });
  return serveStatic(req, res, url);
}
const CONTENT_TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
async function serveStatic(req,res,url) {
  if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Método não permitido'});
  let pathname; try { pathname=decodeURIComponent(url.pathname); } catch { return json(res,400,{error:'URL inválida'}); }
  if(pathname==='/') pathname='/index.html';
  let file=path.resolve(PUBLIC_DIR, '.'+pathname);
  if(file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR+path.sep)) return json(res,403,{error:'Acesso negado'});
  try {
    let data=await fs.readFile(file);
    const ext=path.extname(file).toLowerCase();
    const headers={...securityHeaders(),'Content-Type':CONTENT_TYPES[ext]||'application/octet-stream'};
    if (ext === '.html') headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://abibliadigital.api.br; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    if(pathname.endsWith('/sw.js')) headers['Service-Worker-Allowed']='/';
    if(['/index.html','/app.js','/sw.js'].includes(pathname)) headers['Cache-Control']='no-cache'; else headers['Cache-Control']='public, max-age=3600';
    res.writeHead(200,headers); if(req.method==='HEAD') return res.end(); return res.end(data);
  } catch { return json(res,404,{error:'Arquivo não encontrado'}); }
}
const server=http.createServer(async (req,res)=>{
  try { const url=new URL(req.url,'http://localhost'); await api(req,res,url); }
  catch(error) { console.error('Erro interno:',error.code || error.name || 'InternalError'); if(!res.headersSent) json(res,500,{error:'Erro interno do servidor.'}); else res.end(); }
});
server.requestTimeout=20000;
server.listen(PORT,'0.0.0.0',async()=>{
  console.log(`Palavra Viva server escutando na porta ${PORT}`);
  try { await initDatabase(); console.log('Banco de dados pronto.'); }
  catch(error) { databaseError=error; console.error('Banco indisponível no início:',error.code || error.name || 'DatabaseError'); setTimeout(async function retry(){ try{await initDatabase();console.log('Banco de dados pronto.');}catch(e){databaseError=e;setTimeout(retry,10000);} },10000); }
});
process.on('SIGTERM',async()=>{server.close();if(pool)await pool.end().catch(()=>{});process.exit(0);});
