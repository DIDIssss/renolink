'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const date = value => new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(new Date(value));
  const state = { section:'dashboard', ideas:[], users:[], conversations:[], selected:null, detail:null, deals:{}, before:null, pendingRealtime:new Set(), drafts:{}, renderIdeas:null, renderUsers:null };
  async function api(route, data) {
    let response;
    try { response = await fetch('/api' + route, { method:data === undefined ? 'GET':'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body:data === undefined ? undefined:JSON.stringify(data), signal:AbortSignal.timeout(45000) }); }
    catch { throw Error('Servidor indisponível ou conexão interrompida. Confira se a ação foi concluída antes de reenviar.'); }
    const result = await response.json().catch(()=>({}));
    if (!response.ok) {
      if ([401,403].includes(response.status) && document.body.dataset.page === 'admin') location.href = 'admin-login.html';
      throw Error(result.error || 'Não foi possível concluir a operação.');
    }
    return result;
  }
  function error(err, target = 'adminAlert') { $(target).textContent = err.message; $(target).hidden = false; }
  function notice(text) { $('adminNotice').textContent = text; $('adminNotice').hidden = false; }
  const badge = status => `<span class="team-badge ${status === 'Em análise' ? 'pending':status === 'Rejeitada' ? 'rejected':status === 'Publicada' ? 'approved':''}">${esc(status)}</span>`;
  const empty = (title, text) => `<div class="team-empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
  const table = (head, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${head.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const login = $('adminLoginForm');
  if (login) {
    login.addEventListener('submit', async event => {
      event.preventDefault(); const button = login.querySelector('button'); button.disabled = true; $('adminAlert').hidden = true;
      try { await api('/admin/auth/login', Object.fromEntries(new FormData(login))); location.href = 'admin.html'; }
      catch (err) { error(err); button.disabled = false; }
    });
    return;
  }
  const descriptions = {
    dashboard:['Visão geral','O que está acontecendo e onde sua equipe pode fazer a diferença.'],
    ideas:['Ideias recebidas','Conheça as propostas. Uma análise cuidadosa abre novas possibilidades.'],
    users:['Visitantes','Pessoas e empresas que estão construindo conexões com a RenoLink.'],
    conversations:['Atendimento','Uma conversa próxima para cada visitante.'],
    negotiations:['Negociações','Acompanhe cada oportunidade, do primeiro contato ao próximo passo.'],
    audit:['Histórico de ações','Transparência sobre as decisões e os atendimentos da equipe.']
  };
  async function load() {
    const generation=state.loadGeneration=(state.loadGeneration||0)+1,section=state.section;
    const restoreReplyFocus=document.activeElement?.id==='replyText';
    const currentSearch=document.getElementById('adminSearch')?.value||document.getElementById('userSearch')?.value||'';
    const currentStatus=document.getElementById('adminStatus')?.value||'';
    $('adminAlert').hidden = true;
    document.querySelectorAll('[data-section]').forEach(b => { b.classList.toggle('active', b.dataset.section === state.section); b.setAttribute('aria-current', b.dataset.section === state.section ? 'page':'false'); });
    $('sectionTitle').textContent = descriptions[state.section][0]; $('sectionDescription').textContent = descriptions[state.section][1];
    const content = $('adminContent'); content.setAttribute('aria-busy','true');
    try {
      if (section === 'dashboard') {
        const [stats, { ideas }] = await Promise.all([api('/admin/dashboard'), api('/admin/ideas')]);
        if(generation!==state.loadGeneration)return;
        const pending = ideas.filter(i => i.status === 'Em análise'); state.ideas = ideas;
        content.innerHTML = `<section class="team-metrics" aria-label="Indicadores reais">${[['Ideias recebidas',stats.ideas,'Todas as propostas'],['Aguardando análise',stats.pending,'Próximas decisões da equipe'],['Visitantes cadastrados',stats.users,'Pessoas conectadas'],['Atendimentos abertos',stats.openConversations,'Conversas para acompanhar']].map(([label,value,help])=>`<article class="team-metric"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`).join('')}</section><div class="team-grid"><section class="team-card"><h2>Vamos dar o próximo passo?</h2><p>Propostas aguardando a avaliação da RenoLink.</p>${pending.length ? pending.slice(0,6).map(i=>`<div class="team-task"><div><strong>${esc(i.title)}</strong><small>${esc(i.category)} · ${esc(i.author)}</small></div><button class="btn btn-ghost" data-review="${i.id}">Analisar</button></div>`).join(''):empty('Tudo em dia','Nenhuma proposta aguardando análise.')}</section><section class="team-card"><span class="eyebrow">O CAMINHO DAS IDEIAS</span><h2>Decisões que conectam</h2><div class="team-task"><span>Ideias publicadas</span>${badge(String(stats.published))}</div><div class="team-task"><span>Propostas rejeitadas</span>${badge(String(stats.rejected))}</div><div class="team-task"><span>Solicitações à equipe</span>${badge(String(stats.requests))}</div><div class="team-task"><span>Negociações anteriores</span>${badge(String(stats.negotiations))}</div><p>A manifestação de interesse não publica uma proposta. Cada nova ideia passa pela análise da equipe.</p></section></div>`;
      }
      if (section === 'ideas') {
        const data=await api('/admin/ideas');if(generation!==state.loadGeneration)return;state.ideas=data.ideas;
        content.innerHTML = `<section class="team-card"><h2>Todas as propostas</h2><div class="team-filter"><input id="adminSearch" class="input" type="search" aria-label="Buscar proposta" placeholder="Busque por título, autor ou categoria"><select id="adminStatus" class="select" aria-label="Filtrar status"><option value="">Todos os status</option><option>Em análise</option><option>Publicada</option><option>Rejeitada</option><option>Empresa interessada</option></select></div><div id="ideaRows"></div></section>`;
        const render = () => {
          const term = $('adminSearch').value.toLocaleLowerCase('pt-BR'), status = $('adminStatus').value;
          const rows = state.ideas.filter(i => (!status || i.status === status) && `${i.title} ${i.author} ${i.category}`.toLocaleLowerCase('pt-BR').includes(term));
          $('ideaRows').innerHTML = rows.length ? table(['Proposta','Autor','Status','Recebida',''],rows.map(i=>`<tr><td><strong>${esc(i.title)}</strong><small>${esc(i.category)}</small></td><td>${esc(i.author)}</td><td>${badge(i.status)}</td><td>${date(i.createdAt)}</td><td><button class="btn btn-ghost" data-review="${i.id}">${i.status === 'Em análise' ? 'Analisar':'Ver proposta'}</button></td></tr>`).join('')):empty('Nenhuma proposta encontrada','Tente ajustar sua busca ou filtro.');
        };
        state.renderIdeas=render;
        $('adminSearch').value=currentSearch;$('adminStatus').value=currentStatus;
        $('adminSearch').addEventListener('input',render); $('adminStatus').addEventListener('change',render); render();
      }
      if (section === 'users') {
        const { users } = await api('/admin/users');
        if(generation!==state.loadGeneration)return;
        state.users=users;
        content.innerHTML = `<section class="team-card"><h2>Pessoas por trás das ideias</h2><div class="team-filter"><input id="userSearch" class="input" type="search" aria-label="Buscar visitante" placeholder="Buscar por nome ou e-mail"></div><div id="userRows"></div></section>`;
        const render = () => {
          const rows = state.users.filter(u=>`${u.name} ${u.email}`.toLowerCase().includes($('userSearch').value.toLowerCase()));
          $('userRows').innerHTML = rows.length ? table(['Nome','Contato','Perfil','Desde'], rows.map(u=>`<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.company)}</small></td><td>${esc(u.email)}</td><td>${badge(u.teamRole ? (u.teamRole === 'admin' ? 'Administração':'Atendimento') : (u.role === 'company' ? 'Empresa':'Visitante'))}</td><td>${date(u.createdAt)}</td></tr>`).join('')):empty('Nenhum visitante encontrado','Ajuste o termo da busca.');
        }; state.renderUsers=render;$('userSearch').value=currentSearch;$('userSearch').addEventListener('input',render); render();
      }
      if (section === 'conversations') {
        const data=await api('/admin/conversations');if(generation!==state.loadGeneration)return;state.conversations=data.conversations.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
        const list=state.conversations.length ? state.conversations.map(c=>`<button class="team-conversation ${c.id === state.selected ? 'active':''}" data-conversation="${c.id}"><strong>${esc(c.visitorName)}</strong><small>${esc(c.status)} · ${date(c.updatedAt)}</small></button>`).join(''):empty('Caixa de entrada vazia','As mensagens dos visitantes aparecerão aqui.');
        if($('teamChat')?.dataset.conversation===String(state.selected)&&document.querySelector('.team-conversations'))document.querySelector('.team-conversations').innerHTML=list;
        else content.innerHTML = `<div class="team-inbox"><div class="team-conversations" aria-label="Conversas">${list}</div><section class="team-card team-chat" id="teamChat">${empty('Uma conversa começa com atenção','Selecione um atendimento para ver o histórico e responder.')}</section></div>`;
        if (state.selected && state.conversations.some(c=>c.id === state.selected)) await openConversation(state.selected);
        if(restoreReplyFocus&&$('replyText')){$('replyText').focus();$('replyText').setSelectionRange($('replyText').value.length,$('replyText').value.length);}
      }
      if (section === 'negotiations') {
        const data = await api('/admin/negotiations');if(generation!==state.loadGeneration)return;state.deals = {};
        const rows = [...data.requests.map(r=>({...r,kind:'requests', person:r.visitorName})), ...data.negotiations.map(r=>({...r,kind:'negotiations',person:'Negociação anterior'}))];
        content.innerHTML = `<section class="team-card"><h2>Oportunidades em acompanhamento</h2><p>As mudanças de etapa ficam registradas no histórico da equipe.</p>${rows.length ? table(['Ideia','Participante','Etapa','Próximo passo'], rows.map(r=> {
          const key = r.kind + '-' + r.id; state.deals[key] = r;
          const transitions = { Solicitada:['Em contato','Encerrada'], 'Interesse demonstrado':['Em contato','Em negociação','Encerrada'], 'Em contato':['Em negociação','Encerrada'], 'Em negociação':['Concluída','Encerrada'] };
          const choices = transitions[r.status] || [];
          return `<tr><td>${esc(r.ideaTitle)}</td><td>${esc(r.person)}</td><td>${badge(r.status)}</td><td>${choices.length ? `<label class="sr-only" for="stage-${key}">Próxima etapa</label><select class="select" id="stage-${key}">${choices.map(s=>`<option>${esc(s)}</option>`).join('')}</select><button class="btn btn-ghost" data-deal="${key}">Atualizar etapa</button>`:'Acompanhamento finalizado'}</td></tr>`;
        }).join('')):empty('Nenhuma negociação ainda','Novas solicitações aparecerão aqui.')}</section>`;
      }
      if (section === 'audit') {
        const data = await api('/admin/audit' + (state.before ? '?before=' + state.before:''));
        if(generation!==state.loadGeneration)return;
        content.innerHTML = `<section class="team-card"><h2>Rastro das decisões</h2><p>Até 100 ações por página, da mais recente para a mais antiga.</p>${data.events.length ? table(['Quando','Equipe','Ação','Referência'], data.events.map(e=>`<tr><td>${date(e.createdAt)}</td><td>${esc(e.actorName)}</td><td><strong>${esc(e.action)}</strong><small>${esc(e.detail)}</small></td><td>${esc(e.targetType)} #${e.targetId}</td></tr>`).join('')):empty('Nenhum evento nesta página','As decisões e os atendimentos autorizados ficam registrados aqui.')}<div class="review-actions"><button class="btn btn-ghost" id="auditFirst">Mais recentes</button>${data.nextBefore ? `<button class="btn btn-ghost" id="auditNext" data-cursor="${data.nextBefore}">Anteriores</button>`:''}</div></section>`;
        $('auditFirst').onclick = () => { state.before = null; run(load); };
        if ($('auditNext')) $('auditNext').onclick = () => { state.before = Number($('auditNext').dataset.cursor); run(load); };
      }
    } finally { if(generation===state.loadGeneration)content.setAttribute('aria-busy','false'); }
  }
  async function openConversation(id) {
    if($('replyText')&&state.selected)state.drafts[state.selected]=$('replyText').value;
    const generation=state.conversationGeneration=(state.conversationGeneration||0)+1;
    const data = await api(`/admin/conversations/${id}/messages`);
    if(generation!==state.conversationGeneration||state.section!=='conversations'||!$('teamChat'))return;
    state.selected = id;
    document.querySelectorAll('[data-conversation]').forEach(b => b.classList.toggle('active', Number(b.dataset.conversation) === id));
    const closed = data.conversation.status === 'Encerrada';
    const keepComposer=$('teamChat').dataset.conversation===String(id)&&$('replyForm');
    const markup = `<div class="chat-heading"><div><h2>${esc(data.conversation.visitorName)}</h2>${badge(data.conversation.status)}</div><button class="btn btn-ghost" id="conversationStatus">${closed ? 'Reabrir':'Encerrar'}</button></div><div class="message-list">${data.messages.map(m=>`<div class="message ${m.senderName === 'Equipe RenoLink' ? 'mine':''}"><strong>${esc(m.senderName)}</strong><p>${esc(m.text)}</p><span>${date(m.createdAt)}</span></div>`).join('')}</div><form id="replyForm" class="message-form"><label class="sr-only" for="replyText">Resposta ao visitante</label><textarea id="replyText" class="textarea" maxlength="5000" rows="3" placeholder="Uma resposta que aproxima…" required ${closed ? 'disabled':''}></textarea><button class="btn btn-primary" ${closed ? 'disabled':''}>Enviar resposta</button></form>`;
    if(keepComposer){const fresh=document.createElement('div');fresh.innerHTML=markup;for(const selector of ['.chat-heading','.message-list'])$('teamChat').querySelector(selector).replaceWith(fresh.querySelector(selector));}
    else $('teamChat').innerHTML=markup;
    $('teamChat').dataset.conversation=String(id);$('teamChat').dataset.closed=String(closed);
    state.sending??=new Set();$('replyText').disabled=closed;$('replyForm').querySelector('button').disabled=closed||state.sending.has(id);
    $('replyForm').onsubmit = event => { event.preventDefault();if(state.sending.has(id))return;const composer=$('replyText'),text=composer.value;state.sending.add(id);run(async()=> { const button = $('replyForm').querySelector('button'); button.disabled = true; try { await api(`/admin/conversations/${id}/messages`, { text });if(state.drafts[id]===text)state.drafts[id]='';if(composer.isConnected&&composer.value===text)composer.value='';if($('teamChat')?.dataset.conversation===String(id))await openConversation(id);notice('Resposta enviada ao visitante.'); } finally { state.sending.delete(id);if($('teamChat')?.dataset.conversation===String(id))$('replyForm').querySelector('button').disabled=$('teamChat').dataset.closed==='true'; } }); };
    if(!keepComposer)$('replyText').value=state.drafts[id]||'';
    $('replyText').oninput=()=>{state.drafts[id]=$('replyText').value;};
    $('conversationStatus').onclick = () => run(async()=> { await api(`/admin/conversations/${id}/status`, { status:closed ? 'Aberta':'Encerrada' }); await load(); });
  }
  async function review(id) {
    const { idea, author } = await api('/admin/ideas/' + id); state.detail = idea;
    $('reviewContent').innerHTML = `${badge(idea.status)}<h2 id="reviewTitle">${esc(idea.title)}</h2><p class="muted">${esc(author?.name || 'Comunidade RenoLink')} · ${esc(idea.category)}</p>${author ? `<p class="muted">${esc(author.email)}</p>`:''}${[['Problema',idea.problem],['Solução',idea.solution],['Beneficiários',idea.beneficiaries || 'Não informado'],['Participação',idea.participation],['Parecer anterior',idea.moderation?.reason || 'Sem parecer registrado']].map(([label,text])=>`<h3>${label}</h3><p class="proposal-text">${esc(text)}</p>`).join('')}`;
    $('reviewReason').value = ''; $('reviewAlert').hidden = true;
    for (const id of ['approveIdea','rejectIdea','reviewReason']) $(id).disabled = idea.status !== 'Em análise';
    $('ideaDialog').showModal();
  }
  async function run(action) { try { await action(); } catch(err) { error(err); } }
  document.querySelectorAll('[data-section]').forEach(button => button.onclick = () => { state.section = button.dataset.section; document.querySelector('.team-layout').classList.remove('menu-open'); $('teamMenu').setAttribute('aria-expanded','false'); run(load); });
  $('teamMenu').onclick = () => { const open = document.querySelector('.team-layout').classList.toggle('menu-open'); $('teamMenu').setAttribute('aria-expanded',String(open)); };
  $('refreshAdmin').onclick = () => run(load);
  $('adminLogout').onclick = () => run(async()=> { await api('/auth/logout',{}); localStorage.removeItem('renolinkSession'); location.href = 'admin-login.html'; });
  $('adminContent').onclick = event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.review) run(()=>review(Number(target.dataset.review)));
    if (target.dataset.conversation) run(()=>openConversation(Number(target.dataset.conversation)));
    if (target.dataset.deal) run(async()=> { target.disabled = true; try { const row = state.deals[target.dataset.deal]; await api(`/admin/${row.kind}/${row.id}/status`, { status:$('stage-' + target.dataset.deal).value, updatedAt:row.updatedAt }); notice('Etapa atualizada e registrada no histórico.'); await load(); } finally { target.disabled = false; } });
  };
  $('closeReview').onclick = () => $('ideaDialog').close();
  $('reviewForm').onsubmit = async event => {
    event.preventDefault(); const decision = event.submitter?.value;
    if (!['approve','reject'].includes(decision)) return;
    const buttons = [$('approveIdea'),$('rejectIdea')]; buttons.forEach(b=>b.disabled = true);
    try {
      await api(`/admin/ideas/${state.detail.id}/review`, { decision, reason:$('reviewReason').value, updatedAt:state.detail.updatedAt });
      $('ideaDialog').close(); notice(decision === 'approve' ? 'Ideia aprovada e disponível no portal.':'Parecer registrado. A proposta permanece privada.'); await load();
    } catch(err) { error(err,'reviewAlert'); buttons.forEach(b=>b.disabled = false); }
  };
  run(async()=> {
    const current = await api('/admin/me'); $('adminIdentity').textContent = current.user.name;
    if (current.accessRole === 'support') { document.querySelectorAll('.admin-only').forEach(el=>el.hidden = true); state.section = 'conversations'; }
    await load();
    if(window.RenoLinkRealtime)RenoLinkRealtime.start(async topics=>{
      const relevant={dashboard:['ideas','users','messages','deals','audit'],ideas:['ideas'],users:['users'],conversations:['messages'],negotiations:['deals'],audit:['audit']}[state.section];
      if(!topics.some(t=>relevant.includes(t)))return;
      if($('ideaDialog').open){for(const topic of topics)state.pendingRealtime.add(topic);return;}
      if(state.section==='ideas'&&$('ideaRows')){state.ideas=(await api('/admin/ideas')).ideas;if(state.section==='ideas'&&$('ideaRows'))state.renderIdeas();return;}
      if(state.section==='users'&&$('userRows')){state.users=(await api('/admin/users')).users;if(state.section==='users'&&$('userRows'))state.renderUsers();return;}
      const active=document.activeElement;
      if(active?.matches('#adminSearch,#userSearch,select')){
        for(const topic of topics)state.pendingRealtime.add(topic);
        notice('Novas atualizações disponíveis. Sua edição foi preservada.');return;
      }
      await load();
    });
  });
  document.addEventListener('focusout',()=>setTimeout(()=>{
    if(!state.pendingRealtime.size||$('ideaDialog').open||document.activeElement?.matches('#replyText,#adminSearch,#userSearch,select'))return;
    state.pendingRealtime.clear();run(load);
  },50));
  $('ideaDialog').addEventListener('close',()=>{if(state.pendingRealtime.size){state.pendingRealtime.clear();run(load);}});
})();
