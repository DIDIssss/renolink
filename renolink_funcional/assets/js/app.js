/* =========================================================
   01. CONFIGURAÇÃO E ESTADO
   ========================================================= */

const API = '/api';
const page = document.body.dataset.page || '';
const authRule = document.body.dataset.auth || '';

function getSession() {
  try {
    const data = JSON.parse(localStorage.getItem('renolinkSession'));
    if (data?.token) { localStorage.removeItem('renolinkSession'); return null; }
    return data?.user ? { user: data.user } : null;
  }
  catch { return null; }
}

function setSession(data) {
  localStorage.setItem('renolinkSession', JSON.stringify({ user: data.user }));
}

function clearSession() {
  localStorage.removeItem('renolinkSession');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function slug(value = '') {
  return String(value).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(value));
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  let response;
  try { response = await fetch(`${API}${path}`, { ...options, headers, credentials: 'same-origin', signal:options.signal || AbortSignal.timeout(45000) }); }
  catch { throw new Error('Servidor indisponível ou conexão interrompida. Confira se a ação foi concluída antes de reenviar.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir a operação.'), {status:response.status});
  return data;
}
async function phase5Enabled() { try { return (await api('/features')).phase5 === true; } catch { return false; } }
async function portalSummary(section,user){
  try{return await api('/portal/'+section);}catch(error){if(![404,405].includes(error.status))throw error;}
  // Existing tabs can load new assets before the operator restarts an old backend.
  const enabled=await phase5Enabled(),paths=['/negotiations'];
  if(section==='dashboard')paths.push(user.role==='creator'?'/ideas?mine=1':'/ideas?public=1');
  if(section==='dashboard'&&user.role==='company')paths.push('/messages');
  if(enabled&&(section!=='dashboard'||user.role==='creator'))paths.push('/requests');
  return Object.assign({features:{phase5:enabled},requests:[]},...await Promise.all(paths.map(path=>api(path))));
}

function showAlert(element, message, type = 'error') {
  if (!element) return;
  element.textContent = message;
  element.className = `form-alert ${type}`;
  element.hidden = false;
}

function setButtonLoading(button, loading, label = 'Aguarde...') {
  if (!button) return;
  if (loading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>${label}`;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}

/* =========================================================
   02. NAVEGAÇÃO E SESSÃO
   ========================================================= */

const menuButton = document.getElementById('menuButton');
const mobileMenu = document.getElementById('mobileMenu');
if (menuButton && mobileMenu) {
  menuButton.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
}

function updatePublicNavigation() {
  const logged = Boolean(getSession());
  document.querySelectorAll('.auth-login-link, .auth-register-link').forEach(el => el.hidden = logged);
  document.querySelectorAll('.auth-dashboard-link').forEach(el => el.hidden = !logged);
}

async function hydratePrivateLayout() {
  if (!authRule) return getSession()?.user || null;
  const session = getSession();

  try {
    const { user } = await api('/me');
    setSession({ ...session, user });
    if (user.teamRole && page === 'dashboard') { location.href = 'admin.html'; return null; }
    if (authRule === 'creator' && user.role !== 'creator') {
      location.href = 'dashboard.html';
      return null;
    }
    document.getElementById('userName')?.replaceChildren(document.createTextNode(user.name));
    const roleLabel = user.role === 'company' ? (user.company || 'Empresa') : 'Visitante';
    document.getElementById('userRole')?.replaceChildren(document.createTextNode(roleLabel));
    document.getElementById('sidebarRole')?.replaceChildren(document.createTextNode(user.role === 'company' ? 'Empresa' : 'Visitante'));
    document.getElementById('userAvatar')?.replaceChildren(document.createTextNode((user.name || 'R')[0].toUpperCase()));
    document.querySelectorAll('.creator-only').forEach(el => el.hidden = user.role !== 'creator');
    document.querySelectorAll('.company-only').forEach(el => el.hidden = user.role !== 'company');
    return user;
  } catch (error) {
    if(error.status!==401)throw error;
    clearSession();location.href = 'login.html';return null;
  }
}

document.querySelectorAll('[data-action="logout"]').forEach(link => {
  link.addEventListener('click', async event => {
    event.preventDefault();
    try { await api('/auth/logout', { method:'POST', body:'{}' }); } catch {}
    clearSession();
    location.href = 'index.html';
  });
});

function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === key));
}

/* =========================================================
   03. AUTENTICAÇÃO
   ========================================================= */

async function handleLogin() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const alert = document.getElementById('formAlert');
    alert.hidden = true;
    setButtonLoading(button, true, 'Entrando...');
    try {
      const payload = Object.fromEntries(new FormData(form));
      const data = await api('/auth/login', { method:'POST', body:JSON.stringify(payload) });
      setSession(data);
      if (data.user.teamRole) { location.href = 'admin.html'; return; }
      const params = new URLSearchParams(location.search);
      location.href = RenoLinkSecurity.safeRedirect(params.get('redirect'));
    } catch (error) {
      showAlert(alert, error.message);
      setButtonLoading(button, false);
    }
  });
}

async function handleRegister() {
  const form = document.getElementById('cadastroForm');
  if (!form) return;
  const role = document.getElementById('perfil');
  const companyGroup = document.getElementById('companyGroup');
  const companyInput = document.getElementById('empresa');
  const params = new URLSearchParams(location.search);
  if (params.get('perfil') === 'empresa') role.value = 'company';

  function syncRole() {
    const isCompany = role.value === 'company';
    companyGroup.hidden = !isCompany;
    companyInput.required = isCompany;
  }
  role.addEventListener('change', syncRole);
  syncRole();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const alert = document.getElementById('formAlert');
    alert.hidden = true;
    setButtonLoading(button, true, 'Criando conta...');
    try {
      const payload = Object.fromEntries(new FormData(form));
      const data = await api('/auth/register', { method:'POST', body:JSON.stringify(payload) });
      setSession(data);
      location.href = 'dashboard.html';
    } catch (error) {
      showAlert(alert, error.message);
      setButtonLoading(button, false);
    }
  });
}

/* =========================================================
   04. HOME E INDICADORES PÚBLICOS
   ========================================================= */

async function loadPublicStats() {
  if (!['home', 'company'].includes(page)) return;
  try {
    const stats = await api('/stats');
    document.getElementById('publicIdeasCount')?.replaceChildren(document.createTextNode(`+${stats.ideas}`));
    document.getElementById('publicCompaniesCount')?.replaceChildren(document.createTextNode(stats.companies));
    document.getElementById('publicNegotiationsCount')?.replaceChildren(document.createTextNode(stats.negotiations));
    document.getElementById('companyIdeasCount')?.replaceChildren(document.createTextNode(stats.ideas));
    document.getElementById('companyDealsCount')?.replaceChildren(document.createTextNode(stats.negotiations));
  } catch {}
}

/* =========================================================
   05. DASHBOARD
   ========================================================= */

function statusClass(status = '') {
  if (status.includes('interessada')) return 'deal';
  if (status === 'Publicada') return 'live';
  if (status.includes('análise')) return 'review';
  return 'wait';
}

async function loadDashboard(user) {
  if (page !== 'dashboard' || !user) return;
  setActiveNav('dashboard');
  const firstName = user.name.split(' ')[0];
  document.getElementById('dashboardGreeting').textContent = `Olá, ${firstName}`;

  if (user.role === 'creator') {
    document.getElementById('pageLabel').textContent = 'Meu espaço';
    const {ideas,negotiations,requests,features}=await portalSummary('dashboard',user);
    const upgraded=features.phase5;
    document.getElementById('stat1').textContent = ideas.length;
    document.getElementById('stat2').textContent = ideas.filter(i => i.status === 'Em análise').length;
    document.getElementById('stat3').textContent = ideas.filter(i => i.status === 'Publicada').length;
    document.getElementById('stat4').textContent = negotiations.length + requests.length;
    document.getElementById('dashboardTableBody').innerHTML = ideas.length ? ideas.map(idea => `<tr><td><a class="table-link" href="ideia.html?id=${idea.id}"><strong>${escapeHtml(idea.title)}</strong></a>${upgraded ? `<div><a class="table-link" href="nova-ideia.html?id=${idea.id}">Editar proposta</a></div>`:''}</td><td>${escapeHtml(idea.category)}</td><td><span class="status ${statusClass(idea.status)}">${escapeHtml(idea.status)}</span>${idea.moderation?.reason ? `<p class="review-reason">${escapeHtml(idea.moderation.reason)}</p>`:''}</td><td>${formatDate(idea.updatedAt)}</td></tr>`).join('') : '<tr><td colspan="4" class="table-loading">Você ainda não cadastrou nenhuma ideia.</td></tr>';
  } else {
    document.getElementById('pageLabel').textContent = 'Painel da empresa';
    document.getElementById('dashboardSubtitle').textContent = 'Acompanhe oportunidades e interesses da sua empresa.';
    document.getElementById('dashboardTableTitle').textContent = 'Negociações recentes';
    document.getElementById('dashboardTableSubtitle').textContent = 'Interesses registrados pela sua empresa';
    document.getElementById('statLabel1').textContent = 'Oportunidades públicas';
    document.getElementById('statLabel2').textContent = 'Interesses enviados';
    document.getElementById('statLabel3').textContent = 'Em negociação';
    document.getElementById('statLabel4').textContent = 'Mensagens';
    document.getElementById('dashboardTableHead').innerHTML = '<th>Ideia</th><th>Criador</th><th>Status</th><th>Atualização</th>';
    const {ideas,negotiations,messages}=await portalSummary('dashboard',user);
    document.getElementById('stat1').textContent = ideas.length;
    document.getElementById('stat2').textContent = negotiations.length;
    document.getElementById('stat3').textContent = negotiations.filter(n => n.status).length;
    document.getElementById('stat4').textContent = messages.length;
    document.getElementById('dashboardTableBody').innerHTML = negotiations.length ? negotiations.map(n => `<tr><td><a class="table-link" href="ideia.html?id=${n.ideaId}"><strong>${escapeHtml(n.ideaTitle)}</strong></a></td><td>${escapeHtml(n.creatorName)}</td><td><span class="status deal">${escapeHtml(n.status)}</span></td><td>${formatDate(n.updatedAt)}</td></tr>`).join('') : '<tr><td colspan="4" class="table-loading">Nenhum interesse registrado ainda.</td></tr>';
  }
}

/* =========================================================
   06. CADASTRO DE IDEIAS
   ========================================================= */

function handleIdeaForm() {
  const form = document.getElementById('ideaForm');
  if (!form) return;
  setActiveNav('new');
  const editingId = Number(new URLSearchParams(location.search).get('id'));
  let editingVersion = null;
  if (editingId) {
    form.querySelector('button[type="submit"]').disabled = true;
    Promise.all([api(`/ideas/${editingId}`), api('/me')]).then(([{ idea }, { user }]) => {
      if (idea.userId !== user.id) throw Error('Você só pode editar suas próprias ideias.');
      for (const name of ['title','category','problem','solution','beneficiaries','participation']) if (form.elements[name]) form.elements[name].value = idea[name] || '';
      editingVersion = idea.updatedAt;
      document.querySelector('h1').textContent = 'Aprimore sua ideia';
      document.querySelector('.content-subtitle').textContent = 'Ao salvar, a proposta retorna à análise da equipe RenoLink.';
      form.querySelector('button[type="submit"]').disabled = false;
    }).catch(error => showAlert(document.getElementById('formAlert'),error.message));
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const alert = document.getElementById('formAlert');
    alert.hidden = true;
    setButtonLoading(button, true, 'Enviando...');
    try {
      const payload = Object.fromEntries(new FormData(form));
      if (editingId) payload.updatedAt = editingVersion;
      await api(editingId ? `/ideas/${editingId}/edit` : '/ideas', { method:'POST', body:JSON.stringify(payload) });
      location.href = 'dashboard.html?created=1';
    } catch (error) {
      showAlert(alert, error.message);
      setButtonLoading(button, false);
    }
  });
}

/* =========================================================
   07. MARKETPLACE E DETALHES DA IDEIA
   ========================================================= */

let marketplaceIdeas = [];

function renderMarketplace() {
  const grid = document.getElementById('ideaGrid');
  if (!grid) return;
  const term = slug(document.getElementById('ideaSearch')?.value || '');
  const category = document.getElementById('categoryFilter')?.value || 'all';
  const visible = marketplaceIdeas.filter(idea => {
    const haystack = slug(`${idea.title} ${idea.problem} ${idea.solution} ${idea.category}`);
    return (!term || haystack.includes(term)) && (category === 'all' || idea.category === category);
  });
  document.getElementById('emptyState').hidden = visible.length > 0;
  grid.innerHTML = visible.map(idea => `<article class="idea-card"><span class="mini-status purple">${escapeHtml(idea.category)}</span><h3>${escapeHtml(idea.title)}</h3><p>${escapeHtml(idea.problem)}</p><div class="idea-card-footer"><span>${escapeHtml(idea.potential)} potencial</span><a href="ideia.html?id=${idea.id}">Ver oportunidade <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div></article>`).join('');
}

async function loadMarketplace() {
  if (page !== 'explore') return;
  try {
    const { ideas } = await api('/ideas?public=1');
    marketplaceIdeas = ideas;
    renderMarketplace();
    if(document.getElementById('ideaSearch'))document.getElementById('ideaSearch').oninput=renderMarketplace;
    if(document.getElementById('categoryFilter'))document.getElementById('categoryFilter').onchange=renderMarketplace;
  } catch (error) {
    document.getElementById('ideaGrid').innerHTML = `<div class="form-alert error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadIdeaDetail() {
  if (page !== 'idea-detail') return;
  const id = Number(new URLSearchParams(location.search).get('id'));
  const holder = document.getElementById('ideaDetail');
  const button = document.getElementById('interestButton');
  const alert = document.getElementById('interestAlert');
  button.disabled=true;
  if (!id) { holder.innerHTML = '<div class="form-alert error">Ideia inválida.</div>'; return; }
  try {
    const { idea } = await api(`/ideas/${id}`);
    holder.innerHTML = `<div class="detail-header"><span class="mini-status purple">${escapeHtml(idea.category)}</span><span class="status ${statusClass(idea.status)}">${escapeHtml(idea.status)}</span></div><h1>${escapeHtml(idea.title)}</h1><p class="detail-author">Por ${escapeHtml(idea.author)} • ${idea.interests} interesse(s)</p><div class="detail-section"><h3>Problema identificado</h3><p>${escapeHtml(idea.problem)}</p></div><div class="detail-section"><h3>Solução proposta</h3><p>${escapeHtml(idea.solution)}</p></div><div class="detail-grid"><div><span>Beneficiários</span><strong>${escapeHtml(idea.beneficiaries || 'Não informado')}</strong></div><div><span>Participação</span><strong>${escapeHtml(idea.participation || 'Não informado')}</strong></div><div><span>Potencial</span><strong>${escapeHtml(idea.potential)}</strong></div></div>`;

    const session = getSession();
    button.hidden=false;button.onclick=null;
    const enabled = await phase5Enabled();
    if (!enabled) {
      button.disabled = true; button.textContent = 'Solicitações aguardando ativação da equipe';
    } else if (!session) {
      button.textContent = 'Entrar para conversar com a RenoLink';
      button.onclick=() => location.href = `login.html?redirect=${encodeURIComponent(`ideia.html?id=${id}`)}`;
      button.disabled=false;
    } else if (!['Publicada','Empresa interessada'].includes(idea.status)) {
      button.disabled = true;
      button.textContent = 'Aguardando aprovação da RenoLink';
    } else {
      button.textContent = 'Solicitar negociação à RenoLink';
      button.onclick=async () => {
        alert.hidden = true;
        setButtonLoading(button, true, 'Registrando...');
        try {
          const data = await api('/requests', { method:'POST', body:JSON.stringify({ ideaId:id }) });
          showAlert(alert, data.message || 'Solicitação enviada. Acompanhe em Negociações.', 'success');
          setButtonLoading(button, false);
        } catch (error) {
          showAlert(alert, error.message);
          setButtonLoading(button, false);
        }
      };
      button.disabled=false;
    }
    if (enabled && session?.user.id === idea.userId) {
      const actions = document.createElement('div'); actions.className = 'owner-actions';
      const edit = document.createElement('a'); edit.className = 'btn btn-ghost'; edit.href = `nova-ideia.html?id=${id}`; edit.textContent = 'Editar minha ideia'; actions.append(edit); holder.append(actions);
      if (idea.moderation?.reason) { const note = document.createElement('p'); note.className = 'review-reason'; note.textContent = 'Parecer da equipe: ' + idea.moderation.reason; holder.append(note); }
    }
  } catch (error) {
    holder.innerHTML = `<div class="form-alert error">${escapeHtml(error.message)}</div>`;
    button.hidden = true;
  }
}

/* =========================================================
   08. NEGOCIAÇÕES E MENSAGENS
   ========================================================= */

async function loadNegotiations() {
  if (page !== 'deals') return;
  setActiveNav('deals');
  try {
    const {negotiations,requests}=await portalSummary('deals');
    const list = document.getElementById('negotiationList');
    list.innerHTML = negotiations.length ? negotiations.map(n => `<article class="list-card"><div><span class="mini-status purple">${escapeHtml(n.status)}</span><h3>${escapeHtml(n.ideaTitle)}</h3><p>${escapeHtml(n.companyName)} • ${escapeHtml(n.creatorName)}</p></div><a class="btn btn-ghost" href="ideia.html?id=${n.ideaId}">Ver ideia</a></article>`).join('') : '<div class="empty-state compact"><i class="fa-regular fa-handshake"></i><h3>Nenhuma negociação</h3><p>Quando houver interesse em uma ideia, ela aparecerá aqui.</p></div>';
    if (requests.length) list.innerHTML = requests.map(r => `<article class="list-card"><div><span class="status ${statusClass(r.status)}">${escapeHtml(r.status)}</span><h3>${escapeHtml(r.ideaTitle)}</h3><p>Solicitação à equipe RenoLink · ${formatDate(r.updatedAt)}</p></div><a class="btn btn-ghost" href="mensagens.html">Conversar com a equipe</a></article>`).join('') + (negotiations.length ? list.innerHTML : '');
  } catch (error) {
    showAlert(document.getElementById('negotiationList'), error.message);
  }
}

let refreshVisitorMessages=null;
async function loadMessages(user) {
  if (page !== 'messages' || !user) return;
  setActiveNav('messages');
  const list = document.getElementById('messageList');
  const form = document.getElementById('messageForm');
  const alert = document.getElementById('messageAlert');
  let conversation = null;

  async function refresh() {
    const { conversations } = await api('/team/conversations');
    conversation = conversations[0] || null;
    const messages = conversation ? (await api(`/team/conversations/${conversation.id}/messages`)).messages : [];
    list.innerHTML = messages.length ? messages.map(m => `<div class="message ${m.senderId === user.id ? 'mine' : ''}"><strong>${escapeHtml(m.senderName)}</strong><p>${escapeHtml(m.text)}</p><span>${formatDate(m.createdAt)}</span></div>`).join('') : '<div class="empty-state compact"><h3>Olá! Como podemos ajudar?</h3><p>Envie sua dúvida. A equipe RenoLink acompanha suas mensagens por aqui.</p></div>';
    const closed = conversation?.status === 'Encerrada';
    form.querySelector('button').disabled = closed; document.getElementById('messageText').disabled = closed;
    if (closed) showAlert(alert,'Atendimento encerrado. A equipe pode reabri-lo quando necessário.','success');
    list.scrollTop = list.scrollHeight;
  }
  refreshVisitorMessages=refresh;

  document.getElementById('refreshMessages')?.addEventListener('click',async()=> { try { await refresh(); } catch(error) { showAlert(alert,error.message); } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = document.getElementById('messageText').value.trim();
    if (!text) return;
    const button = form.querySelector('button'); button.disabled = true;
    try {
      await api(conversation ? `/team/conversations/${conversation.id}/messages` : '/team/conversations', { method:'POST', body:JSON.stringify({ text }) });
      form.reset();
      await refresh();
    } catch (error) { showAlert(alert, error.message); }
    finally { button.disabled = conversation?.status === 'Encerrada'; }
  });
  try { await refresh(); } catch (error) { showAlert(alert, error.message); form.querySelector('button').disabled = true; }
}

/* =========================================================
   09. INICIALIZAÇÃO
   ========================================================= */

(async function init() {
  if (authRule || (getSession() && ['idea-detail','explore'].includes(page))) {
    document.body.classList.add('has-visitor-nav');
    const nav = document.createElement('nav'); nav.className = 'visitor-mobile-nav'; nav.setAttribute('aria-label','Navegação do visitante');
    nav.innerHTML = [['dashboard.html','fa-house','Início','dashboard'],['nova-ideia.html','fa-lightbulb','Nova ideia','new-idea'],['explorar.html','fa-magnifying-glass','Explorar','explore'],['mensagens.html','fa-message','Equipe','messages'],['negociacoes.html','fa-handshake','Negociações','deals']].map(([href,icon,label,key])=>`<a href="${href}" class="${page === key ? 'active':''}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('');
    const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = 'Sair'; logout.addEventListener('click', async()=> { try { await api('/auth/logout',{ method:'POST',body:'{}' }); } finally { clearSession(); location.href='index.html'; } }); nav.append(logout); document.body.append(nav);
  }
  updatePublicNavigation();
  handleLogin();
  handleRegister();
  handleIdeaForm();
  loadPublicStats();
  loadMarketplace();
  loadIdeaDetail();

  const user = await hydratePrivateLayout();
  if (page === 'dashboard') await loadDashboard(user);
  if (page === 'deals') await loadNegotiations();
  if (page === 'messages') await loadMessages(user);
  if(user&&window.RenoLinkRealtime)RenoLinkRealtime.start(async topics=>{
    if(page==='messages'&&topics.includes('messages')&&refreshVisitorMessages)await refreshVisitorMessages();
    if(page==='dashboard'&&topics.some(t=>['ideas','deals'].includes(t)))await loadDashboard(user);
    if(page==='deals'&&topics.includes('deals'))await loadNegotiations();
    if(page==='explore'&&topics.includes('ideas'))await loadMarketplace();
    if(page==='idea-detail'&&topics.some(t=>['ideas','deals'].includes(t)))await loadIdeaDetail();
  });
})().catch(error => {
  const holder = document.querySelector('.content') || document.querySelector('main');
  if (holder) { const alert = document.createElement('p'); alert.className = 'form-alert error'; alert.setAttribute('role','alert'); alert.textContent = error.message; holder.prepend(alert); }
});
