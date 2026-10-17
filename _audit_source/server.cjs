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
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  connectionTimeoutMillis: 10000
}) : null;
let databaseReady = false;
let databaseError = null;

function json(res, status, value, headers={}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers });
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
  const response = await fetch(url, { ...options, signal:AbortSignal.timeout(15000) });
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
    generationConfig:{temperature:0.4,responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{theme:{type:'STRING',enum:THEMES},response:{type:'STRING'},connection:{type:'STRING'}},required:['theme','response','connection']}}
  };
  const data = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
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
  let body='';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error('Mensagem muito grande'), {status:413});
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Corpo JSON inválido'), {status:400}); }
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
    const response=await fetch(BIBLE_API_BASE+upstreamPath,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    const payload=await response.text();
    res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/json; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'});res.end(payload);
  } catch { json(res,502,{error:'Não foi possível conectar à fonte bíblica agora.'}); }
}
async function api(req,res,url) {
  if(req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true,aiConfigured:Boolean(process.env.GEMINI_API_KEY),databaseConfigured:databaseReady,model:GEMINI_MODEL,limit:DAILY_LIMIT});
  if(url.pathname==='/api/bible' || url.pathname.startsWith('/api/bible/')) return handleBible(req,res,url);
  if(req.method==='GET' && url.pathname==='/api/usage') {
    if(!databaseReady) return json(res,503,{error:'Banco de dados não está pronto'});
    const id=url.searchParams.get('installationId')||'';
    if(!validInstallId(id)) return json(res,400,{error:'Identificador de instalação inválido'});
    try { return json(res,200,{ok:true,...await currentUsage(id)}); } catch { return json(res,503,{error:'Não foi possível consultar o limite diário'}); }
  }
  if(req.method==='POST' && url.pathname==='/api/chat') {
    if(!databaseReady || !process.env.GEMINI_API_KEY || !process.env.ID_SALT) return json(res,503,{error:'SERVER_NOT_CONFIGURED'});
    let body; try { body=await readBody(req); } catch(e) { return json(res,e.status||400,{error:e.message}); }
    const id=String(body.installationId||''), message=String(body.message||'').trim(), context=Array.isArray(body.context)?body.context.slice(-6).map(v=>{if(typeof v==='string')return {user:v.slice(0,300),assistant:''};if(v&&typeof v==='object')return {user:String(v.user||'').slice(0,300),assistant:String(v.assistant||v.reply||'').slice(0,500)};return null;}).filter(v=>v&&v.user):[];
    if(!validInstallId(id)) return json(res,400,{error:'Identificador de instalação inválido'});
    if(!message || message.length>700) return json(res,400,{error:'A mensagem deve ter entre 1 e 700 caracteres'});
    let reservation;
    try { reservation=await reserveUsage(id); } catch { return json(res,503,{error:'Não foi possível verificar o limite diário'}); }
    if(!reservation) return json(res,429,{error:'Você atingiu o limite diário de 20 mensagens.',code:'DAILY_LIMIT_REACHED',limit:DAILY_LIMIT,remaining:0});
    try {
      const interpretation=await interpretSituation(message,context);
      const {theme,response,connection}=interpretation;
      if(theme==='other') return json(res,200,{ok:true,theme,themeLabel:THEME_LABELS[theme],response,used:reservation.used,remaining:reservation.remaining,limit:DAILY_LIMIT});
      const ref=PASSAGES[theme]; if(!ref) throw new Error('Tema sem referência permitida');
      const passage=await retrieveVerse(ref);
      return json(res,200,{ok:true,theme,themeLabel:THEME_LABELS[theme],response,connection,passage,used:reservation.used,remaining:reservation.remaining,limit:DAILY_LIMIT});
    } catch(e) {
      await releaseUsage(reservation).catch(()=>{});
      console.error('Falha ao classificar ou confirmar passagem:',e.message);
      return json(res,502,{error:'Não foi possível confirmar uma passagem agora. Tente novamente mais tarde.',code:'PASSAGE_UNAVAILABLE'});
    }
  }
  if(url.pathname.startsWith('/api/')) return json(res,404,{error:'Rota não encontrada'});
  return serveStatic(req,res,url);
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
    const headers={'Content-Type':CONTENT_TYPES[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
    if(pathname.endsWith('/sw.js')) headers['Service-Worker-Allowed']='/';
    if(['/index.html','/app.js','/sw.js'].includes(pathname)) headers['Cache-Control']='no-cache'; else headers['Cache-Control']='public, max-age=3600';
    res.writeHead(200,headers); if(req.method==='HEAD') return res.end(); return res.end(data);
  } catch { return json(res,404,{error:'Arquivo não encontrado'}); }
}
const server=http.createServer(async (req,res)=>{
  try { const url=new URL(req.url,'http://localhost'); await api(req,res,url); }
  catch(error) { console.error('Erro interno:',error.message); if(!res.headersSent) json(res,500,{error:'Erro interno do servidor.'}); else res.end(); }
});
server.requestTimeout=20000;
server.listen(PORT,'0.0.0.0',async()=>{
  console.log(`Palavra Viva server escutando na porta ${PORT}`);
  try { await initDatabase(); console.log('Banco de dados pronto.'); }
  catch(error) { databaseError=error; console.error('Banco indisponível no início:',error.message); setTimeout(async function retry(){ try{await initDatabase();console.log('Banco de dados pronto.');}catch(e){databaseError=e;setTimeout(retry,10000);} },10000); }
});
process.on('SIGTERM',async()=>{server.close();if(pool)await pool.end().catch(()=>{});process.exit(0);});
