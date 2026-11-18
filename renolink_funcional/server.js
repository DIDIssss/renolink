/* =========================================================
   RENOLINK - SERVIDOR LOCAL
   API HTTP + banco JSON usando apenas módulos nativos do Node.js.
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const security = require('./lib/security');
const { localStore } = require('./lib/data');
const phase5 = require('./lib/phase5');

const ROOT = __dirname;
const PUBLIC_FILES = new Set([
  '/index.html', '/empresa.html', '/explorar.html', '/ideia.html', '/cadastro.html',
  '/login.html', '/dashboard.html', '/nova-ideia.html', '/mensagens.html', '/negociacoes.html',
  '/assets/css/style.css', '/assets/js/app.js', '/assets/js/security.js', '/assets/img/logo-renolink.svg',
  '/admin.html', '/admin-login.html', '/assets/js/admin.js', '/assets/css/phase5.css', '/assets/js/realtime.js'
]);
const PUBLIC_STATUSES = new Set(['Publicada', 'Empresa interessada']);
const CATEGORIES = new Set(['Varejo', 'Tecnologia', 'Agronegócio', 'Logística', 'Saúde', 'Indústria', 'Serviços', 'Sustentabilidade']);
const PARTICIPATION = new Set(['Vender a ideia', 'Licenciar a solução', 'Participar do desenvolvimento', 'Ainda não sei']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function json(res, status, data) {
  // A resposta só será enviada depois do commit da transação.
  res.result = { status, data };
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024) { reject(security.fail(413, 'Corpo da requisição muito grande.')); return; }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        const data = raw ? JSON.parse(raw) : {};
        if (!data || Array.isArray(data) || typeof data !== 'object') throw Error();
        resolve(data);
      }
      catch { reject(security.fail(400, 'JSON inválido.')); }
    });
    req.on('aborted', () => reject(security.fail(400, 'Requisição interrompida.')));
    req.on('error', () => reject(security.fail(400, 'Falha ao ler requisição.')));
  });
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function publicUser(user) {
  return security.publicUser(user);
}

function getAuth(req, db) {
  return security.auth(req, db);
}

function requireAuth(req, res, db, role = null) {
  const auth = getAuth(req, db);
  if (!auth) {
    json(res, 401, { error: 'Faça login para continuar.' });
    return null;
  }
  if (role && auth.user.role !== role) {
    json(res, 403, { error: 'Seu perfil não possui acesso a esta ação.' });
    return null;
  }
  return auth;
}

function enrichIdea(idea, db, privateView = false) {
  const owner = db.users.find(user => user.id === idea.userId);
  const interests = db.negotiations.filter(item => item.ideaId === idea.id).length;
  const { moderation, ...publicIdea } = idea;
  return { ...publicIdea, ...(privateView && moderation ? { moderation: { reason: moderation.reason, reviewedAt: moderation.reviewedAt } } : {}), author: owner ? owner.name : 'Comunidade RenoLink', interests };
}

async function handleApi(req, res, url, db) {
  const pathname = url.pathname;
  if (await phase5.handle(req, res, url, db, json)) return;

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true });
  }
  if(req.method==='GET'&&['/api/portal/dashboard','/api/portal/deals'].includes(pathname)){
    const current=requireAuth(req,res,db);if(!current)return;
    const dashboard=pathname.endsWith('/dashboard'),features={phase5:db.meta.schemaVersion===5};
    const paths=['/api/negotiations'];
    if(dashboard)paths.push(current.user.role==='creator'?'/api/ideas?mine=1':'/api/ideas?public=1');
    if(dashboard&&current.user.role==='company')paths.push('/api/messages');
    if(features.phase5&&(!dashboard||current.user.role==='creator'))paths.push('/api/requests');
    const summary={features,requests:[]};
    for(const path of paths){const partial={};await handleApi(req,partial,new URL(path,'http://localhost'),db);if(partial.result.status!==200)return json(res,partial.result.status,partial.result.data);Object.assign(summary,partial.result.data);}
    return json(res,200,summary);
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const data = req.data;
    if (['teamRole', 'accessRole', 'isAdmin', 'staff'].some(key => key in data)) throw security.fail(400, 'Permissões de equipe não são aceitas no cadastro público.');
    const name = security.text(data.name, 3, 120, 'Nome');
    const email = normalizeEmail(data.email);
    const password = typeof data.password === 'string' ? data.password : '';
    const role = data.role || 'creator';
    const company = security.text(data.company || '', 0, 160, 'Empresa');

    if (!security.validEmail(data.email) || !security.validEmail(email) || password.length < 10 || password.length > 128 || !['creator', 'company'].includes(role)) {
      return json(res, 400, { error: 'Informe e-mail válido, perfil permitido e senha entre 10 e 128 caracteres.' });
    }
    if (role === 'company' && company.length < 2) {
      return json(res, 400, { error: 'Informe o nome da empresa.' });
    }
    if (db.users.some(user => user.email === email)) {
      return json(res, 409, { error: 'Já existe uma conta com este e-mail.' });
    }

    const credentials = req.preparedPassword || await security.passwordHash(password);
    const user = {
      id: db.meta.nextUserId++, name, email, role, company,
      ...credentials,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);

    res.cookie = security.issueSession({ userId: user.id }, db).cookie;
    return json(res, 201, { user: publicUser(user) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const data = req.data;
    const email = normalizeEmail(data.email);
    const password = typeof data.password === 'string' ? data.password : '';
    if (!security.validEmail(email) || !password || password.length > 128) return json(res, 400, { error: 'Credenciais inválidas.' });
    const user = db.users.find(item => item.email === email);

    if (!(await security.verifyRequestPassword(req, password, user))) {
      return json(res, 401, { error: 'E-mail ou senha incorretos.' });
    }

    if (!user.passwordHash.startsWith('scrypt$')) Object.assign(user, req.preparedPasswordUpgrade || await security.passwordHash(password));
    res.cookie = security.issueSession({ userId: user.id }, db).cookie;
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const auth = getAuth(req, db);
    if (auth) auth.session.revokedAt = new Date().toISOString();
    res.cookie = security.cookieValue('', 0);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout-all') {
    const auth = requireAuth(req, res, db);
    if (!auth) return;
    for (const session of db.sessions) if (session.userId === auth.user.id) session.revokedAt = new Date().toISOString();
    res.cookie = security.cookieValue('', 0);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const auth = requireAuth(req, res, db);
    if (!auth) return;
    return json(res, 200, { user: { ...publicUser(auth.user), teamRole: phase5.member(db, auth.user.id)?.accessRole || null } });
  }

  if (req.method === 'GET' && pathname === '/api/stats') {
    const aggregates=db[require('./lib/mysql-scopes').STATS];if(aggregates)return json(res,200,aggregates);
    const publicIdeas = db.ideas.filter(idea => ['Publicada', 'Empresa interessada'].includes(idea.status));
    return json(res, 200, {
      ideas: publicIdeas.length,
      companies: db.users.filter(user => user.role === 'company').length,
      negotiations: db.negotiations.length,
      publicIdeas: publicIdeas.length
    });
  }

  if (req.method === 'GET' && pathname === '/api/ideas') {
    const mine = url.searchParams.get('mine') === '1';
    const onlyPublic = url.searchParams.get('public') === '1';
    let list = [...db.ideas];

    if (mine) {
      const auth = requireAuth(req, res, db);
      if (!auth) return;
      list = list.filter(idea => idea.userId === auth.user.id);
    }
    if (onlyPublic || !mine) {
      list = list.filter(idea => ['Publicada', 'Empresa interessada'].includes(idea.status));
    }

    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return json(res, 200, { ideas: list.map(idea => enrichIdea(idea, db, mine)) });
  }

  const ideaMatch = pathname.match(/^\/api\/ideas\/(\d+)$/);
  if (req.method === 'GET' && ideaMatch) {
    const idea = db.ideas.find(item => item.id === Number(ideaMatch[1]));
    if (!idea || (!PUBLIC_STATUSES.has(idea.status) && getAuth(req, db)?.user.id !== idea.userId)) return json(res, 404, { error: 'Ideia não encontrada.' });
    return json(res, 200, { idea: enrichIdea(idea, db, getAuth(req, db)?.user.id === idea.userId) });
  }

  if (req.method === 'POST' && pathname === '/api/ideas') {
    const auth = requireAuth(req, res, db, 'creator');
    if (!auth) return;
    const data = req.data;
    const required = ['title', 'category', 'problem', 'solution'];
    if (required.some(key => !String(data[key] || '').trim())) {
      return json(res, 400, { error: 'Preencha título, categoria, problema e solução.' });
    }
    security.text(data.title, 1, 200, 'Título');
    security.text(data.problem, 1, 10000, 'Problema');
    security.text(data.solution, 1, 10000, 'Solução');
    security.text(data.beneficiaries || '', 0, 2000, 'Beneficiários');
    if (!CATEGORIES.has(data.category) || !PARTICIPATION.has(data.participation || 'Ainda não sei')) throw security.fail(400, 'Categoria ou participação inválida.');

    const now = new Date().toISOString();
    const idea = {
      id: db.meta.nextIdeaId++, userId: auth.user.id,
      title: String(data.title).trim(), category: String(data.category).trim(),
      problem: String(data.problem).trim(), solution: String(data.solution).trim(),
      beneficiaries: String(data.beneficiaries || '').trim(),
      participation: String(data.participation || 'Ainda não sei').trim(),
      status: 'Em análise', potential: 'Em avaliação', createdAt: now, updatedAt: now
    };
    db.ideas.push(idea);
    return json(res, 201, { idea: enrichIdea(idea, db) });
  }

  const interestMatch = pathname.match(/^\/api\/ideas\/(\d+)\/interest$/);
  if (req.method === 'POST' && interestMatch) {
    const auth = requireAuth(req, res, db, 'company');
    if (!auth) return;
    const idea = db.ideas.find(item => item.id === Number(interestMatch[1]));
    if (!idea || !PUBLIC_STATUSES.has(idea.status)) return json(res, 404, { error: 'Ideia não encontrada.' });
    if (idea.userId === null) return json(res, 400, { error: 'Esta ideia de demonstração não possui autor cadastrado para negociação.' });

    const existing = db.negotiations.find(item => item.ideaId === idea.id && item.companyUserId === auth.user.id);
    if (existing) return json(res, 200, { negotiation: existing, message: 'Interesse já registrado.' });

    const now = new Date().toISOString();
    const negotiation = {
      id: db.meta.nextNegotiationId++, ideaId: idea.id,
      creatorUserId: idea.userId, companyUserId: auth.user.id,
      status: 'Interesse demonstrado', createdAt: now, updatedAt: now
    };
    db.negotiations.push(negotiation);
    return json(res, 201, { negotiation, message: 'Interesse enviado ao criador.' });
  }

  if (req.method === 'GET' && pathname === '/api/negotiations') {
    const auth = requireAuth(req, res, db);
    if (!auth) return;
    const items = db.negotiations
      .filter(item => auth.user.role === 'company' ? item.companyUserId === auth.user.id : item.creatorUserId === auth.user.id)
      .map(item => {
        const idea = db.ideas.find(idea => idea.id === item.ideaId);
        const creator = db.users.find(user => user.id === item.creatorUserId);
        const company = db.users.find(user => user.id === item.companyUserId);
        return { ...item, ideaTitle: idea?.title || 'Ideia', creatorName: creator?.name || 'Criador', companyName: company?.company || company?.name || 'Empresa' };
      });
    return json(res, 200, { negotiations: items });
  }

  if (req.method === 'GET' && pathname === '/api/messages') {
    const auth = requireAuth(req, res, db);
    if (!auth) return;
    const items = db.messages
      .filter(item => item.fromUserId === auth.user.id || item.toUserId === auth.user.id)
      .map(item => ({
        ...item,
        fromName: db.users.find(user => user.id === item.fromUserId)?.name || 'Usuário',
        toName: db.users.find(user => user.id === item.toUserId)?.name || 'Usuário'
      }))
      .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    return json(res, 200, { messages: items });
  }

  if (req.method === 'POST' && pathname === '/api/messages') {
    const auth = requireAuth(req, res, db);
    if (!auth) return;
    const data = req.data;
    const text = security.text(data.text, 1, 5000, 'Mensagem');
    const toUserId = Number(data.toUserId);
    if (!text || !db.users.some(user => user.id === toUserId)) {
      return json(res, 400, { error: 'Mensagem ou destinatário inválido.' });
    }
    const message = { id: db.meta.nextMessageId++, fromUserId: auth.user.id, toUserId, text, createdAt: new Date().toISOString() };
    db.messages.push(message);
    return json(res, 201, { message });
  }

  return json(res, 404, { error: 'Rota da API não encontrada.' });
}

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw security.fail(400, 'Caminho inválido.'); }
  if (pathname === '/') pathname = '/index.html';
  // A lista é exata: um arquivo novo, backup ou configuração nunca fica público por acidente.
  if (!PUBLIC_FILES.has(pathname) || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404); return res.end('Arquivo não encontrado.');
  }
  const requested = path.join(ROOT, pathname);
  let real;
  try { real = fs.realpathSync(requested); } catch { res.writeHead(404); return res.end('Arquivo não encontrado.'); }
  const relative = path.relative(fs.realpathSync(ROOT), real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(404); return res.end(); }
  fs.stat(requested, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Arquivo não encontrado.');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(requested).toLowerCase()] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(real);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

function createServer(store, options = {}) {
  const hosting=require('./lib/hosting'),hostingPolicy=options.hosting||hosting.policy();
  const read=fn=>store.read?store.read(fn):store.transaction(fn);
  const limit = security.limiter();
  function failureStatus(req,status){
    const kind=req.authAttempt;
    if((kind==='login'&&status===401)||(kind==='register'&&[400,409,422].includes(status))){
      try{limit(`failed-${kind}:${req.clientAddress||req.socket.remoteAddress}`,kind==='login'?10:5,15*60*1000);}catch{return 429;}
    }
    return status;
  }
  const realtime = require('./lib/realtime').createRealtime(store,options.realtime);
  const listener = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const send = (status, data, cookie) => {
      if (res.destroyed) return;
      if (cookie) res.setHeader('Set-Cookie', cookie);
      if (status === 429) res.setHeader('Retry-After', '900');
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      if(hostingPolicy.log)hosting.logRequest(req,res,options.logger);
      const transport=hosting.context(req,hostingPolicy);req.clientAddress=transport.ip;
      if(hostingPolicy.production&&transport.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
      const url = new URL(req.url, 'http://localhost');
      if(req.method==='GET'&&['/health/live','/health/ready'].includes(url.pathname)){
        limit(`requests:${req.clientAddress}`,600,60*1000);
        if(url.pathname==='/health/live')return send(200,{ok:true});
        try{const ready=store.health?await store.health():await read(db=>db.meta.schemaVersion===5);return send(ready?200:503,{ok:!!ready});}catch{return send(503,{ok:false});}
      }
      if (!url.pathname.startsWith('/api/')) {
        if (url.pathname === '/admin.html') {
          const authorized = await read(db => {
            const current = getAuth(req, db);
            return current && phase5.member(db, current.user.id);
          });
          if (!authorized) { res.writeHead(303, { Location: '/admin-login.html' }); return res.end(); }
        }
        return serveStatic(req, res, url);
      }
      const ip = req.clientAddress; // Encaminhamento apenas pelo proxy local explicitamente configurado.
      const validationStarted=performance.now();
      limit(`requests:${ip}`, 600, 60 * 1000);
      if(url.pathname === '/api/events' && req.method === 'GET') { await realtime.attach(req,res); return; }
      if (!['GET', 'POST'].includes(req.method)) throw security.fail(405, 'Método não permitido.');
      if (req.method === 'POST') {
        security.sameOrigin(req);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw security.fail(415, 'Envie application/json.');
        if (['/api/auth/login', '/api/admin/auth/login'].includes(url.pathname)) {
          req.authAttempt='login';limit(`login:${ip}`,120,15*60*1000);limit.check(`failed-login:${ip}`,10);
        }
        if (url.pathname === '/api/auth/register') {
          req.authAttempt='register';limit(`register:${ip}`,60,15*60*1000);limit.check(`failed-register:${ip}`,5);
        }
        if (!url.pathname.startsWith('/api/auth/')) limit(`writes:${ip}`, 120, 60 * 1000);
        req.data = await body(req); // Nenhum lock é retido enquanto o cliente envia o corpo.
        if (req.authAttempt==='login') limit(`account:${security.digest(normalizeEmail(req.data.email))}`,10,15*60*1000);
        if (req.authAttempt==='register') limit(`registration-account:${security.digest(normalizeEmail(req.data.email))}`,5,15*60*1000);
      }
      options.observe?.('validationIncludingBody',performance.now()-validationStarted);
      if(req.authAttempt){const started=performance.now();await security.prepareAuthentication(req,store);options.observe?.('authentication',performance.now()-started);}
      const staged = {},persistenceStarted=performance.now();
      if(store.api)await store.api(req,url,db=>handleApi(req,staged,url,db));
      else if(req.method==='GET')await read(db => handleApi(req, staged, url, db));
      else await store.transaction(db => handleApi(req, staged, url, db));
      options.observe?.('apiPersistence',performance.now()-persistenceStarted);
      if(req.method === 'POST' && staged.result.status < 400) realtime.wake();
      const responseStatus=failureStatus(req,staged.result.status);
      send(responseStatus,responseStatus===429?{error:'Muitas solicitações. Tente novamente mais tarde.'}:staged.result.data,staged.cookie);
    } catch (error) {
      // Não registrar payloads, cookies, credenciais ou detalhes do driver.
      const status = failureStatus(req,error.status || 500);
      if (status === 500) console.error('Falha interna na operação RenoLink.');
      send(status, { error: status === 500 ? 'Erro interno do servidor local.' : error.message });
    }
  };
  const server=http.createServer((req,res)=>options.requestScope?options.requestScope(req,res,()=>listener(req,res)):listener(req,res));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  server.realtime = realtime;
  const originalClose = server.close.bind(server);
  server.close = callback => { realtime.close(); return originalClose(callback); };
  return server;
}

async function initializeStorage(store) {
  if (typeof store.initialize === 'function') return store.initialize();
  return store.transaction(() => {});
}

function startupFailureLog(stage, error, env=process.env) {
  const code=typeof error?.code==='string'?error.code:'';
  let category;
  if (['ER_ACCESS_DENIED_ERROR'].includes(code)) category='mysql_authentication';
  else if (['ER_BAD_DB_ERROR'].includes(code)) category='mysql_database';
  else if (['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR','RENOLINK_SCHEMA_INVALID'].includes(code)) category='mysql_schema';
  else if (['ER_DBACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR'].includes(code)) category='mysql_permissions';
  else if (/^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HANDSHAKE_SSL_ERROR)/.test(code)) category='mysql_tls';
  else if (['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','PROTOCOL_CONNECTION_LOST','PROTOCOL_SEQUENCE_TIMEOUT'].includes(code)) category='mysql_network';
  else if (stage==='hosting_configuration') category='hosting_configuration';
  else if (stage==='storage_configuration') category='mysql_configuration';
  else if (stage==='storage_initialization') category='mysql_initialization';
  else if (stage==='server_creation') category='server_initialization';
  else if (stage==='http_listen'&&code==='EADDRINUSE') category='port_in_use';
  else if (stage==='http_listen'&&['EACCES','EPERM'].includes(code)) category='listen_permission';
  else if (stage==='http_listen') category='http_listen_error';
  else category='startup_error';
  return JSON.stringify({event:'startup_failed',environment:env.RENDER==='true'?'render':'application',stage,category});
}

async function start({ env=process.env, storageFactory, serverFactory=createServer, onStartupStage } = {}) {
  onStartupStage?.('hosting_configuration');
  const {port:PORT,host:HOST}=require('./lib/hosting').binding(env);
  const hostingPolicy=require('./lib/hosting').policy(env);
  if (env.STORAGE_DRIVER && !['json', 'mysql', 'postgres'].includes(env.STORAGE_DRIVER)) throw Error('Driver de armazenamento inválido.');
  if (env.NODE_ENV === 'production' && (env.COOKIE_SECURE !== '1' || !/^https:\/\//.test(env.APP_ORIGIN || '') || env.STORAGE_DRIVER !== 'mysql')) throw Error('Produção exige MySQL, APP_ORIGIN HTTPS e COOKIE_SECURE=1.');
  onStartupStage?.('storage_configuration');
  const store = storageFactory ? storageFactory() : env.STORAGE_DRIVER === 'mysql'
    ? require('./lib/mysql').mysqlStore(require('./lib/mysql').config(env))
    : env.STORAGE_DRIVER === 'postgres'
    ? require('./lib/postgres').postgresStore()
    : localStore({ source: path.join(ROOT, 'data/db.json'), file: env.RENOLINK_RUNTIME_DB || path.join(ROOT, 'data/runtime/db.json'), backupDir: path.join(ROOT, 'data/backups') });
  onStartupStage?.('storage_initialization');
  try { await initializeStorage(store); } catch (error) { await store.close(); throw error; }
  onStartupStage?.('server_creation');
  const server = serverFactory(store,{hosting:hostingPolicy});
  const runtimeMetrics=env.APP_LOG_FORMAT==='json'?require('./lib/runtime-metrics').monitor(server):null;
  server.once('close',()=>runtimeMetrics?.close());
  onStartupStage?.('http_listen');
  server.on('error', async error => {
    if(env.APP_LOG_FORMAT==='json')console.error(startupFailureLog('http_listen',error,env));
    else console.error('Não foi possível iniciar o servidor. Verifique a porta e a configuração.');
    await store.close(); process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    if(env.APP_LOG_FORMAT==='json')console.log(JSON.stringify({event:'listening',bind:HOST,port:server.address().port,environment:env.APP_ENV==='render'?'render':env.APP_ENV==='staging'?'staging':'application'}));
    else console.log(`RenoLink local: http://localhost:${server.address().port}`);
  });
  let stopping=false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>{server.closeAllConnections();},10000);deadline.unref();
    server.close(async () => {clearTimeout(deadline);await store.close();process.exit(0);});
  });
  process.once('exit', () => { if (store.file) store.close(); });
  return { server, store };
}
if (require.main === module) {
  let startupStage='hosting_configuration';
  start({onStartupStage:stage=>{startupStage=stage;}}).catch(error => {
  if(process.env.APP_LOG_FORMAT==='json')console.error(startupFailureLog(startupStage,error));
  else console.error('Inicialização recusada. Verifique ambiente, TLS e disponibilidade/schema do banco.');
  process.exitCode = 1;
  });
}
module.exports = { createServer, initializeStorage, start, startupFailureLog };
