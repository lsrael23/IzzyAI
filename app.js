(()=>{'use strict';
const $=id=>document.getElementById(id);
const showErr=m=>{const n=$('authError'),a=$('authScreen');if(n&&a&&!a.classList.contains('hidden'))n.textContent=m};
window.addEventListener('error',e=>showErr('Erreur JavaScript : '+(e.message||'inconnue')));
window.addEventListener('unhandledrejection',e=>showErr('Erreur : '+((e.reason&&e.reason.message)||e.reason||'inconnue')));
const API='https://izzyai.onrender.com';
const SUPABASE_URL='https://xtulmimrbvzokvrglken.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_nWnm3EA3f4qAsh-RVIkyqA_-FtTBrE0';
const ADMIN_USER_ID='c1086e22-ff59-48ba-a1f2-f46bcfed6a91';
if(!window.supabase){$('authError').textContent='Impossible de charger le client Supabase. Vérifie ta connexion puis recharge la page.';return}
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const K={prefs:'izzyAI.prefs.v1',memories:'izzyAI.memories.v1',chats:'izzyAI.chats.v2',projects:'izzyAI.projects.v1',tasks:'izzyAI.tasks.v1',active:'izzyAI.activeChat.v2'};
const read=(k,d)=>{try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch{return d}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const uid=()=>crypto?.randomUUID?.()||'izzy-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
let session=null,user=null,isAdmin=false,authMode='login',recoveryMode=false,chats=[],projects=[],tasks=[],memories=[],activeId='',sending=false,selectedImageData=null,webSearch=false,voiceOn=true,lastUserMessage='',lastAssistantMessage='',toastTimer,prefs={tone:'casual',energy:70,nickname:'',speakReplies:true};
function toast(t){const n=$('toast');n.textContent=t;n.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.classList.add('hidden'),2400)}
function setStatus(t,k=''){const n=$('status');n.textContent=t;n.className='status'+(k?' '+k:'')}
function userKey(k){return 'izzyAI.user.'+(user?.id||'signedout')+'.'+k}
function loadUserData(){prefs=read(userKey('prefs'),read(K.prefs,{tone:'casual',energy:70,nickname:'',speakReplies:true}));memories=read(userKey('memories'),read(K.memories,[]));chats=read(userKey('chats'),read(K.chats,[]));projects=read(userKey('projects'),read(K.projects,[]));tasks=read(userKey('tasks'),read(K.tasks,[]));if(!Array.isArray(chats))chats=[];if(!Array.isArray(projects))projects=[];if(!Array.isArray(tasks))tasks=[];if(!Array.isArray(memories))memories=[];memories=memories.filter(x=>typeof x==='string').slice(0,50);activeId=localStorage.getItem(userKey('active'))||''}
function save(k,v){write(userKey(k),v)}
function currentChat(){return chats.find(c=>c.id===activeId)||null}
function newChat(){const c={id:uid(),title:'Nouveau chat',updatedAt:Date.now(),messages:[]};chats.unshift(c);activeId=c.id;save('chats',chats);localStorage.setItem(userKey('active'),activeId);renderHistory();showPanel('chat');renderChat();closeMenu();$('messageInput').focus()}
function saveChats(){save('chats',chats);localStorage.setItem(userKey('active'),activeId);renderHistory()}
function updateChatTitle(c){if(c&&c.title==='Nouveau chat'){const f=c.messages.find(m=>m.role==='user');if(f)c.title=f.text.replace(/\s+/g,' ').slice(0,42)+(f.text.length>42?'…':'')}}
function renderHistory(){const root=$('historyList'),q=$('historySearch').value.trim().toLowerCase();root.replaceChildren();const list=[...chats].sort((a,b)=>b.updatedAt-a.updatedAt).filter(c=>(c.title||'').toLowerCase().includes(q)||c.messages.some(m=>(m.text||'').toLowerCase().includes(q)));if(!list.length){const p=document.createElement('p');p.className='small-note';p.style.padding='0 8px';p.textContent=q?'Aucun résultat.':'Tes conversations apparaîtront ici.';root.append(p);return}list.slice(0,50).forEach(c=>{const b=document.createElement('button');b.className='history-item'+(c.id===activeId?' active':'');const s=document.createElement('span');s.textContent=c.title||'Conversation';b.append(s);b.onclick=()=>{activeId=c.id;localStorage.setItem(userKey('active'),activeId);renderHistory();showPanel('chat');renderChat();closeMenu()};const d=document.createElement('button');d.className='del';d.textContent='×';d.setAttribute('aria-label','Supprimer cette conversation');d.onclick=e=>{e.stopPropagation();if(confirm('Supprimer cette conversation de cet appareil ?')){chats=chats.filter(x=>x.id!==c.id);if(activeId===c.id)activeId='';saveChats();if(!activeId&&chats.length)activeId=chats[0].id;if(!activeId)newChat();else{localStorage.setItem(userKey('active'),activeId);renderHistory();renderChat()}}};b.append(d);root.append(b)})}
function showPanel(name){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));const panel=$(name==='chat'?'chatPanel':name+'Panel');if(panel)panel.classList.add('active');$('currentTitle').textContent=name==='chat'?(currentChat()?.title||'Nouveau chat'):({projects:'Projets',tasks:'Tâches',settings:'Paramètres',memories:'Ma mémoire',admin:'Administration'}[name]||'IZZY AI');if(name==='projects')renderProjects();if(name==='tasks')renderTasks();if(name==='memories')renderMemories();if(name==='admin')refreshAdmin();closeMenu()}
function closeMenu(){$('sidebar').classList.remove('open');$('overlay').classList.remove('show')}
function cleanText(src){return String(src??'').replace(/\r/g,'').replace(/\\\[|\\\]/g,'').replace(/\\\(|\\\)/g,'').replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g,'$1').replace(/\\(?:times|cdot)/g,' × ').replace(/\\(?:div)/g,' ÷ ').replace(/\\(?:leq|le)/g,'≤').replace(/\\(?:geq|ge)/g,'≥').replace(/\\neq/g,'≠').replace(/\\approx/g,'≈').replace(/\\rightarrow|\\Longrightarrow|\\to/g,' → ').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,'($1)/($2)').replace(/\$\$([\s\S]*?)\$\$/g,'$1').replace(/\$([^$\n]+)\$/g,'$1').replace(/\\begin\{[^}]+\}|\\end\{[^}]+\}/g,'').replace(/\\[,;!]/g,' ').replace(/\\[a-zA-Z]+/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
function inline(parent,text){const re=/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;let pos=0,m;while((m=re.exec(text))){if(m.index>pos)parent.append(document.createTextNode(text.slice(pos,m.index)));const t=m[0];let el;if(t[0]==='['){const z=t.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(z){el=document.createElement('a');el.textContent=z[1];el.href=z[2];el.target='_blank';el.rel='noopener noreferrer'}}else if(t[0]==='`'){el=document.createElement('code');el.textContent=t.slice(1,-1)}else if(t.startsWith('**')||t.startsWith('__')){el=document.createElement('strong');el.textContent=t.slice(2,-2)}else{el=document.createElement('em');el.textContent=t.slice(1,-1)}parent.append(el||document.createTextNode(t));pos=re.lastIndex}if(pos<text.length)parent.append(document.createTextNode(text.slice(pos)))}
function renderAnswer(root,raw){root.replaceChildren();const lines=cleanText(raw).split('\n');let para=[],list=null,code=false,codeLines=[];const flushP=()=>{if(!para.length)return;const p=document.createElement('p');inline(p,para.join(' '));root.append(p);para=[]},flushL=()=>{if(list){root.append(list);list=null}},flushC=()=>{const pre=document.createElement('pre'),c=document.createElement('code');c.textContent=codeLines.join('\n');pre.append(c);root.append(pre);codeLines=[]};for(const line of lines){if(line.trim().startsWith('```')){flushP();flushL();if(code){flushC();code=false}else code=true;continue}if(code){codeLines.push(line);continue}if(!line.trim()){flushP();flushL();continue}const item=line.match(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/);if(item){flushP();const tag=/^\s*\d+[.)]\s+/.test(line)?'ol':'ul';if(!list||list.tagName.toLowerCase()!==tag){flushL();list=document.createElement(tag)}const li=document.createElement('li');inline(li,line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/,''));list.append(li);continue}flushL();const h=line.match(/^#{1,3}\s+(.+)$/);if(h){flushP();const el=document.createElement('h3');inline(el,h[1]);root.append(el);continue}if(/^>\s?/.test(line)){flushP();const q=document.createElement('blockquote');inline(q,line.replace(/^>\s?/,''));root.append(q);continue}if(/^---+$/.test(line.trim())){flushP();root.append(document.createElement('hr'));continue}para.push(line.trim())}if(code)flushC();flushP();flushL()}

async function send(retry=false){if(sending)return;if(!session?.access_token)return toast('Connecte-toi pour envoyer un message');const input=$('messageInput'),raw=input.value.trim(),image=selectedImageData;if(!raw&&!image)return;const message=raw||'Analyse cette image et explique-moi ce que tu observes.';if(!retry){addMessage(message+(image?'\n[Photo jointe]':''),'user');lastUserMessage=message}input.value='';input.style.height='auto';$('welcome').classList.add('hidden');sending=true;$('sendBtn').disabled=true;$('typing').classList.remove('hidden');const pref=preferences();prefs=pref;save('prefs',{tone:pref.tone,energy:pref.energy,nickname:pref.nickname,speakReplies:pref.speakReplies});try{const endpoint=image?'/vision':'/chat',payload={message,conversationId:activeId,preferences:pref};if(image)payload.imageData=image;if(webSearch&&!image)payload.webSearch=true;const r=await authFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout?AbortSignal.timeout(90000):undefined});const ct=r.headers.get('content-type')||'';const data=ct.includes('application/json')?await r.json():{error:(await r.text()).slice(0,180)};if(!r.ok)throw Error(data.error||'Erreur HTTP '+r.status);if(typeof data.reply!=='string'||!data.reply.trim())throw Error('Le serveur n’a pas renvoyé de réponse.');addMessage(data.reply,'ai');speak(data.reply);if(image)clearPhoto();setStatus('● Serveur connecté','good')}catch(e){addMessage('Je n’arrive pas à répondre pour le moment. '+(e.message&&!e.message.includes('Failed to fetch')?e.message:'Vérifie la connexion au serveur puis réessaie.'),'ai');setStatus('● Connexion à vérifier','bad')}finally{sending=false;$('sendBtn').disabled=false;$('typing').classList.add('hidden')}}
$('sendBtn').onclick=()=>send();$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});$('messageInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,160)+'px'});
$('webBtn').onclick=()=>{webSearch=!webSearch;$('webBtn').classList.toggle('active',webSearch);$('webBtn').setAttribute('aria-pressed',String(webSearch));toast(webSearch?'Recherche web activée pour le prochain message':'Recherche web désactivée')};$('voiceBtn').onclick=()=>{voiceOn=!voiceOn;$('voiceBtn').textContent=voiceOn?'■ Voix activée':'■ Voix coupée';if(!voiceOn&&'speechSynthesis'in window)speechSynthesis.cancel()};$('stopBtn').onclick=()=>{if('speechSynthesis'in window)speechSynthesis.cancel()};$('newChatBtn').onclick=newChat;$('topNewChat').onclick=newChat;
$('clearChatBtn').onclick=()=>{const c=currentChat();if(!c||!c.messages.length)return toast('Cette conversation est déjà vide');if(confirm('Effacer les messages de cette conversation ?')){c.messages=[];c.title='Nouveau chat';c.updatedAt=Date.now();saveChats();renderChat();toast('Conversation effacée')}};
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.panel==='admin'&&!isAdmin)return toast('Accès administrateur refusé');showPanel(b.dataset.panel)}));$('menuBtn').onclick=()=>{$('sidebar').classList.add('open');$('overlay').classList.add('show')};$('overlay').onclick=closeMenu;$('searchChatsBtn').onclick=()=>{$('historySearchWrap').classList.toggle('hidden');$('historySearch').focus();renderHistory()};$('historySearch').oninput=renderHistory;
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('messageInput').value=b.dataset.prompt;send()}));

function addMessage(text,role,opts={}){
  const chat=currentChat();
  if(!chat)return null;

  const row=document.createElement('div');
  row.className='message-row '+role;

  const av=document.createElement('div');
  av.className='avatar';
  av.textContent=role==='ai'?'I':'T';

  const body=document.createElement('div');
  body.className='message-body';

  if(role==='ai')renderAnswer(body,text);
  else body.textContent=text;

  const timestamp=document.createElement('div');
  timestamp.className='message-timestamp';
  timestamp.textContent=new Date(opts.at||Date.now()).toLocaleTimeString('fr-FR',{
    hour:'2-digit',
    minute:'2-digit'
  });
  body.append(timestamp);

  row.append(av,body);
  $('messages').append(row);

  if(role==='user'&&opts.actions!==false&&!String(text).includes('[Photo jointe]')){
    const acts=document.createElement('div');
    acts.className='message-actions';

    const edit=document.createElement('button');
    edit.type='button';
    edit.textContent='Modifier';
    edit.onclick=()=>{
      const current=currentChat();
      if(!current)return;

      const rows=Array.from($('messages').children);
      const index=rows.indexOf(row);
      if(index<0||index>=current.messages.length)return;

      const revised=prompt('Modifie ton message :',String(text));
      if(revised===null||!revised.trim())return;

      current.messages.splice(index);
      current.updatedAt=Date.now();
      saveChats();
      renderChat();

      $('messageInput').value=revised.trim();
      $('messageInput').dispatchEvent(new Event('input'));
      $('messageInput').focus();

      send();
    };

    acts.append(edit);
    body.append(acts);
  }

  if(role==='ai'&&opts.actions!==false){
    const acts=document.createElement('div');
    acts.className='message-actions';

    [['Copier','copy'],['Lire','read'],['Partager','share'],
     ['Nouveau chat depuis ici','branch'],['Réessayer','retry']
    ].forEach(([label,act])=>{
      const b=document.createElement('button');
      b.type='button';
      b.textContent=label;
      b.onclick=()=>messageAction(act,text);
      acts.append(b);
    });

    ['👍','👎'].forEach(value=>{
      const b=document.createElement('button');
      b.type='button';
      b.textContent=value;
      b.setAttribute('aria-label',value==='👍'?'Bonne réponse':'Mauvaise réponse');
      b.style.opacity='0.65';

      b.onclick=()=>{
        const selected=b.dataset.selected==='true';

        acts.querySelectorAll('[aria-label="Bonne réponse"],[aria-label="Mauvaise réponse"]').forEach(btn=>{
          btn.dataset.selected='false';
          btn.style.opacity='0.65';
        });

        if(!selected){
          b.dataset.selected='true';
          b.style.opacity='1';

          const current=currentChat();
          if(current){
            const message=[...current.messages].reverse().find(m=>
              m.role==='ai'&&m.text===String(text)
            );
            if(message){
              message.feedback=value==='👍'?'positive':'negative';
              saveChats();
            }
          }

          toast(value==='👍'?'Merci pour ton avis !':'Avis enregistré.');
        }
      };

      acts.append(b);
    });

    body.append(acts);
  }

  if(opts.store!==false){
    chat.messages.push({
      role,
      text:String(text),
      at:Date.now()
    });
    chat.updatedAt=Date.now();
    updateChatTitle(chat);
    saveChats();
    $('currentTitle').textContent=chat.title;
  }

  if(role==='ai')lastAssistantMessage=text;

  $('messages').scrollTop=$('messages').scrollHeight;
  return row;
}

function renderChat(){
  const root=$('messages');
  root.replaceChildren();

  const chat=currentChat();
  $('welcome').classList.toggle('hidden',!!chat?.messages?.length);

  if(!chat){
    const c={
      id:uid(),
      title:'Nouveau chat',
      updatedAt:Date.now(),
      messages:[]
    };
    chats.unshift(c);
    activeId=c.id;
    saveChats();
    return renderChat();
  }

  chat.messages.forEach(m=>addMessage(m.text,m.role,{
    store:false,
    actions:true,
    at:m.at
  }));

  $('currentTitle').textContent=chat.title;
  root.scrollTop=root.scrollHeight;
}

function renderChat(){
  const root=$('messages');
  root.replaceChildren();

  const chat=currentChat();
  $('welcome').classList.toggle('hidden',!!chat?.messages?.length);

  if(!chat){
    const c={
      id:uid(),
      title:'Nouveau chat',
      updatedAt:Date.now(),
      messages:[]
    };
    chats.unshift(c);
    activeId=c.id;
    saveChats();
    return renderChat();
  }

  chat.messages.forEach(m=>{
    addMessage(m.text,m.role,{
      store:false,
      actions:m.role==='ai',
      at:m.at
    });
  });

  $('currentTitle').textContent=chat.title;
  root.scrollTop=root.scrollHeight;
}

function renderChat(){const root=$('messages');root.replaceChildren();const chat=currentChat();$('welcome').classList.toggle('hidden',!!chat?.messages?.length);if(!chat){const c={id:uid(),title:'Nouveau chat',updatedAt:Date.now(),messages:[]};chats.unshift(c);activeId=c.id;saveChats();return renderChat()}chat.messages.forEach(m=>addMessage(m.text,m.role,{store:false,actions:m.role==='ai'}));$('currentTitle').textContent=chat.title;root.scrollTop=root.scrollHeight}
function speak(text) {
  if (
    !voiceOn ||
    !$('speakReplies').checked ||
    !('speechSynthesis' in window)
  ) return;

  speechSynthesis.cancel();

  const message = cleanText(text)
    .replace(/https?:\/\/\S+/g, ' lien web ')
    .trim();

  if (!message) return;

  // Détection approximative de la langue du texte
  function detectLanguage(text) {
    if (/[\u3040-\u30ff]/.test(text)) return 'ja';
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';

    const lower = text.toLowerCase();

    const frenchWords =
      /\b(bonjour|salut|merci|avec|pour|mais|donc|parce que|comment|pourquoi|oui|non|je|tu|vous|nous|est|suis|ça|être|avoir)\b/;

    const englishWords =
      /\b(hello|hi|thanks|please|with|for|but|because|how|why|yes|no|the|you|your|are|is|what|when|where|can|will)\b/;

    const fr = (lower.match(/\b(bonjour|salut|merci|avec|pour|mais|donc|comment|pourquoi|je|tu|vous|nous|être|avoir)\b/g) || []).length;
    const en = (lower.match(/\b(hello|thanks|please|with|because|how|why|the|you|your|what|when|where|can|will)\b/g) || []).length;

    if (fr > en || frenchWords.test(lower) && fr >= en) return 'fr';
    if (en > fr || englishWords.test(lower)) return 'en';

    return (navigator.language || 'fr-FR').split('-')[0].toLowerCase();
  }

  const language = detectLanguage(message);
  const voices = speechSynthesis.getVoices();

  const preferredVoice =
    voices.find(v => v.lang.toLowerCase() === language) ||
    voices.find(v => v.lang.toLowerCase().startsWith(language + '-'));

  const utterance = new SpeechSynthesisUtterance(message);

  utterance.lang = preferredVoice
    ? preferredVoice.lang
    : language === 'fr' ? 'fr-FR'
    : language === 'en' ? 'en-US'
    : language;

  if (preferredVoice) utterance.voice = preferredVoice;

  utterance.rate = 0.94;
  utterance.pitch = 0.96;
  utterance.volume = 1;

  speechSynthesis.speak(utterance);
}
async function messageAction(action,text){if(action==='copy'){try{await navigator.clipboard.writeText(cleanText(text));toast('Réponse copiée')}catch{toast('Copie non disponible')}return}if(action==='read'){speak(text);return}if(action==='share'){try{if(navigator.share)await navigator.share({title:'Réponse IZZY AI',text:cleanText(text)});else{await navigator.clipboard.writeText(cleanText(text));toast('Texte copié')}}catch{}return}if(action==='retry'){const last=[...(currentChat()?.messages||[])].reverse().find(m=>m.role==='user');if(last){$('messageInput').value=last.text;await send(true)}return}if(action==='branch'){const old=[...(currentChat()?.messages||[])];newChat();old.slice(-4).forEach(m=>addMessage(m.text,m.role));const last=[...old].reverse().find(m=>m.role==='user');if(last){$('messageInput').value='Continue cette discussion à partir de ce contexte :\n'+last.text;$('messageInput').focus()}toast('Nouveau chat créé avec le contexte récent')}}
function preferences(){return{tone:$('tone').value,energy:Number($('energy').value),nickname:$('nickname').value.trim().slice(0,32),speakReplies:$('speakReplies').checked,memories:memories.slice(0,50)}}
function clearPhoto(){selectedImageData=null;$('attachImage').removeAttribute('src');$('attachPreview').classList.remove('visible');$('cameraInput').value='';$('galleryInput').value=''}
function preparePhoto(file){if(!file)return;if(!file.type.startsWith('image/'))return toast('Choisis une image valide');if(file.size>15*1024*1024)return toast('Image trop lourde : maximum 15 Mo');const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,1280/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const ctx=canvas.getContext('2d');if(!ctx)return;ctx.drawImage(img,0,0,canvas.width,canvas.height);selectedImageData=canvas.toDataURL('image/jpeg',.78);$('attachImage').src=selectedImageData;$('attachPreview').classList.add('visible')};img.src=reader.result};reader.readAsDataURL(file)}
$('cameraBtn').onclick=()=>$('cameraInput').click();$('galleryBtn').onclick=()=>$('galleryInput').click();$('cameraInput').onchange=e=>preparePhoto(e.target.files?.[0]);$('galleryInput').onchange=e=>preparePhoto(e.target.files?.[0]);$('removeImageBtn').onclick=clearPhoto;
async function authFetch(path,options={}){if(!session?.access_token)throw Error('Ta session a expiré. Reconnecte-toi.');const headers={...(options.headers||{}),Authorization:'Bearer '+session.access_token};return fetch(API+path,{...options,headers})}
async function checkServer(){try{const r=await fetch(API+'/health',{cache:'no-store'});const d=await r.json();if(!r.ok||d.status!=='ok')throw Error();setStatus('● Serveur connecté','good')}catch{setStatus('● Serveur à vérifier','bad')}}
async function checkAdmin(){isAdmin=false;try{const r=await authFetch('/admin/me',{cache:'no-store'});const d=await r.json();isAdmin=!!(r.ok&&d.isAdmin&&user&&user.id===ADMIN_USER_ID)}catch{}$('adminBtn').classList.toggle('hidden',!isAdmin);$('adminTag').classList.toggle('hidden',!isAdmin);if(!isAdmin&&$('adminPanel').classList.contains('active'))showPanel('chat')}

async function refreshAdmin() {
  if (!isAdmin || !user) {
    toast('Accès administrateur refusé');
    return;
  }

  const health = $('adminHealth');
  const account = $('adminAccount');

  health.textContent = 'Vérification du serveur…';
  account.textContent = user.email || user.id;

  // Créer la zone des comptes une seule fois.
  let usersSection = $('adminUsersSection');

  if (!usersSection) {
    usersSection = document.createElement('div');
    usersSection.id = 'adminUsersSection';
    usersSection.className = 'field';
    usersSection.style.marginTop = '24px';

    const heading = document.createElement('h3');
    heading.textContent = 'Comptes utilisateurs';

    const description = document.createElement('p');
    description.className = 'small-note';
    description.textContent =
      'Liste des comptes enregistrés sur IZZY AI.';

    const count = document.createElement('p');
    count.id = 'adminUsersCount';
    count.className = 'small-note';

    const list = document.createElement('div');
    list.id = 'adminUsersList';
    list.className = 'list-items';

    usersSection.append(heading, description, count, list);
    $('adminPanel').append(usersSection);
  }

  const list = $('adminUsersList');
  const count = $('adminUsersCount');

  list.replaceChildren();
  count.textContent = 'Chargement des comptes…';

  try {
    // Vérifier l'état du serveur.
    const healthResponse = await authFetch('/health', {
      cache: 'no-store'
    });

    const healthData = await healthResponse.json();

    health.textContent =
      healthResponse.ok && healthData.status === 'ok'
        ? 'Serveur opérationnel • Supabase : ' +
          (healthData.supabaseConfigured ? 'connecté' : 'non configuré') +
          ' • IA : ' +
          (healthData.aiConfigured ? 'configurée' : 'non configurée')
        : 'État du serveur à vérifier';

    // Demander les comptes au serveur protégé.
    const response = await authFetch('/admin/users', {
      cache: 'no-store'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || 'Impossible de récupérer les comptes (HTTP ' +
        response.status + ').'
      );
    }

    if (!Array.isArray(data.users)) {
      throw new Error('Format de réponse des comptes invalide.');
    }

    count.textContent =
      data.users.length + ' compte' +
      (data.users.length > 1 ? 's' : '') + ' trouvé' +
      (data.users.length > 1 ? 's' : '');

    if (data.users.length === 0) {
      list.textContent = 'Aucun compte utilisateur trouvé.';
      return;
    }

    data.users.forEach((accountData, index) => {
      const card = document.createElement('div');
      card.className = 'list-item';
      card.style.display = 'block';
      card.style.padding = '14px';
      card.style.marginBottom = '10px';

      const email = document.createElement('div');
      email.style.fontWeight = '600';
      email.style.overflowWrap = 'anywhere';
      email.textContent = accountData.email || 'E-mail non renseigné';

      const created = document.createElement('p');
      created.className = 'small-note';

      const createdDate = accountData.createdAt
        ? new Date(accountData.createdAt)
        : null;

      created.textContent =
        'Création : ' +
        (createdDate && !Number.isNaN(createdDate.getTime())
          ? createdDate.toLocaleString('fr-FR')
          : 'Date inconnue');

      const lastLogin = document.createElement('p');
      lastLogin.className = 'small-note';

      const loginDate = accountData.lastSignInAt
        ? new Date(accountData.lastSignInAt)
        : null;

      lastLogin.textContent =
        'Dernière connexion : ' +
        (loginDate && !Number.isNaN(loginDate.getTime())
          ? loginDate.toLocaleString('fr-FR')
          : 'Aucune connexion enregistrée');

      const status = document.createElement('p');
      status.className = 'small-note';
      status.textContent = accountData.emailConfirmed
        ? 'E-mail confirmé'
        : 'E-mail non confirmé';

      const id = document.createElement('p');
      id.className = 'small-note';
      id.style.overflowWrap = 'anywhere';
      id.textContent = 'ID : ' + (accountData.id || 'Inconnu');

      if (accountData.id === ADMIN_USER_ID) {
        const badge = document.createElement('span');
        badge.textContent = 'Compte créateur';
        badge.style.display = 'inline-block';
        badge.style.marginTop = '8px';
        badge.style.padding = '4px 9px';
        badge.style.border = '1px solid #b99a52';
        badge.style.borderRadius = '999px';
        badge.style.color = '#e4c779';
        badge.style.fontSize = '12px';
        card.append(email, badge, created, lastLogin, status, id);
      } else {
        card.append(email, created, lastLogin, status, id);
      }

      list.append(card);
    });

  } catch (error) {
    health.textContent = 'Serveur à vérifier';

    count.textContent = 'Chargement impossible';

    const message = document.createElement('p');
    message.className = 'small-note';
    message.textContent =
      error.message || 'Une erreur est survenue.';

    list.replaceChildren(message);
  }
}

async function send(retry=false){if(sending)return;if(!session?.access_token)return toast('Connecte-toi pour envoyer un message');const input=$('messageInput'),raw=input.value.trim(),image=selectedImageData;if(!raw&&!image)return;const message=raw||'Analyse cette image et explique-moi ce que tu observes.';if(!retry){addMessage(message+(image?'\n[Photo jointe]':''),'user');lastUserMessage=message}input.value='';input.style.height='auto';$('welcome').classList.add('hidden');sending=true;$('sendBtn').disabled=true;$('typing').classList.remove('hidden');const pref=preferences();prefs=pref;save('prefs',{tone:pref.tone,energy:pref.energy,nickname:pref.nickname,speakReplies:pref.speakReplies});try{const endpoint=image?'/vision':'/chat',payload={message,conversationId:activeId,preferences:pref};if(image)payload.imageData=image;if(webSearch&&!image)payload.webSearch=true;const r=await authFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout?AbortSignal.timeout(90000):undefined});const ct=r.headers.get('content-type')||'';const data=ct.includes('application/json')?await r.json():{error:(await r.text()).slice(0,180)};if(!r.ok)throw Error(data.error||'Erreur HTTP '+r.status);if(typeof data.reply!=='string'||!data.reply.trim())throw Error('Le serveur n’a pas renvoyé de réponse.');addMessage(data.reply,'ai');speak(data.reply);if(image)clearPhoto();setStatus('● Serveur connecté','good')}catch(e){addMessage('Je n’arrive pas à répondre pour le moment. '+(e.message&&!e.message.includes('Failed to fetch')?e.message:'Vérifie la connexion au serveur puis réessaie.'),'ai');setStatus('● Connexion à vérifier','bad')}finally{sending=false;$('sendBtn').disabled=false;$('typing').classList.add('hidden')}}
$('sendBtn').onclick=()=>send();$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});$('messageInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,160)+'px'});
$('webBtn').onclick=()=>{webSearch=!webSearch;$('webBtn').classList.toggle('active',webSearch);$('webBtn').setAttribute('aria-pressed',String(webSearch));toast(webSearch?'Recherche web activée pour le prochain message':'Recherche web désactivée')};$('voiceBtn').onclick=()=>{voiceOn=!voiceOn;$('voiceBtn').textContent=voiceOn?'■ Voix activée':'■ Voix coupée';if(!voiceOn&&'speechSynthesis'in window)speechSynthesis.cancel()};$('stopBtn').onclick=()=>{if('speechSynthesis'in window)speechSynthesis.cancel()};$('newChatBtn').onclick=newChat;$('topNewChat').onclick=newChat;
$('clearChatBtn').onclick=()=>{const c=currentChat();if(!c||!c.messages.length)return toast('Cette conversation est déjà vide');if(confirm('Effacer les messages de cette conversation ?')){c.messages=[];c.title='Nouveau chat';c.updatedAt=Date.now();saveChats();renderChat();toast('Conversation effacée')}};
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.panel==='admin'&&!isAdmin)return toast('Accès administrateur refusé');showPanel(b.dataset.panel)}));$('menuBtn').onclick=()=>{$('sidebar').classList.add('open');$('overlay').classList.add('show')};$('overlay').onclick=closeMenu;$('searchChatsBtn').onclick=()=>{$('historySearchWrap').classList.toggle('hidden');$('historySearch').focus();renderHistory()};$('historySearch').oninput=renderHistory;
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('messageInput').value=b.dataset.prompt;send()}));

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

$('micBtn').onclick = () => {
  if (!SR) {
    return toast('La saisie vocale n’est pas disponible ici');
  }

  const rec = new SR();
  const browserLanguage = (navigator.language || 'fr-FR').toLowerCase();

  // Utilise la langue du navigateur, avec le français comme solution de secours.
  rec.lang = browserLanguage.startsWith('en')
    ? 'en-US'
    : browserLanguage.startsWith('es')
      ? 'es-ES'
      : browserLanguage.startsWith('pt')
        ? 'pt-BR'
        : browserLanguage.startsWith('de')
          ? 'de-DE'
          : browserLanguage.startsWith('it')
            ? 'it-IT'
            : 'fr-FR';

  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = event => {
    const transcript = event.results?.[0]?.[0]?.transcript;
    if (!transcript) {
      toast('Je n’ai pas compris. Réessaie.');
      return;
    }

    $('messageInput').value = transcript;
    send();
  };

  rec.onerror = event => {
    const errors = {
      'not-allowed': 'Autorise le micro dans les réglages du navigateur.',
      'no-speech': 'Je n’ai rien entendu. Réessaie.',
      'network': 'La reconnaissance vocale nécessite une connexion réseau.',
      'audio-capture': 'Aucun micro accessible.'
    };

    toast(errors[event.error] || 'La reconnaissance vocale a échoué.');
  };

  rec.onend = () => {
    $('micBtn').classList.remove('active');
  };

  rec.start();
  $('micBtn').classList.add('active');
  toast('Je t’écoute…');
};

$('energy').oninput=()=>$('energyValue').textContent=$('energy').value+' %';$('savePersonality').onclick=()=>{const p=preferences();prefs=p;save('prefs',{tone:p.tone,energy:p.energy,nickname:p.nickname,speakReplies:p.speakReplies});$('profileName').textContent=p.nickname||user?.email||'IZZY AI';toast('Réglages enregistrés')};
function renderMemories(){const root=$('memoryList');root.replaceChildren();if(!memories.length){root.textContent='Aucun souvenir pour le moment.';root.className='list-items small-note';return}root.className='list-items';memories.forEach((m,i)=>{const row=document.createElement('div');row.className='list-item';const s=document.createElement('span');s.textContent=m;const b=document.createElement('button');b.textContent='Supprimer';b.onclick=()=>{memories.splice(i,1);save('memories',memories);renderMemories()};row.append(s,b);root.append(row)})}
function addMemory(){const v=$('memoryInput').value.trim();if(!v)return;if(memories.length>=50)return toast('Maximum 50 souvenirs');memories.push(v);save('memories',memories);$('memoryInput').value='';renderMemories();toast('Souvenir enregistré sur cet appareil')}
$('addMemory').onclick=addMemory;$('memoryInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addMemory()}};$('deleteMemory').onclick=()=>{if(confirm('Effacer tous les souvenirs de ce compte sur cet appareil ?')){memories=[];save('memories',memories);renderMemories()}};$('exportMemory').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(memories,null,2)],{type:'application/json'}));a.href=url;a.download='izzy-ai-souvenirs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
function renderProjects(){const root=$('projectsList');root.replaceChildren();if(!projects.length){root.textContent='Aucun projet pour le moment.';root.className='list-items small-note';return}root.className='list-items';projects.forEach((p,i)=>{const r=document.createElement('div');r.className='list-item';const s=document.createElement('span');s.textContent=p;const b=document.createElement('button');b.textContent='Supprimer';b.onclick=()=>{projects.splice(i,1);save('projects',projects);renderProjects()};r.append(s,b);root.append(r)})}
function addProject(){const v=$('projectInput').value.trim();if(!v)return;projects.unshift(v);save('projects',projects);$('projectInput').value='';renderProjects()}$('addProjectBtn').onclick=addProject;$('projectInput').onkeydown=e=>{if(e.key==='Enter')addProject()};
function renderTasks(){const root=$('tasksList');root.replaceChildren();if(!tasks.length){root.textContent='Aucune tâche pour le moment.';root.className='list-items small-note';return}root.className='list-items';tasks.forEach((t,i)=>{const r=document.createElement('div');r.className='list-item';const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!t.done;cb.setAttribute('aria-label','Tâche terminée');cb.onchange=()=>{tasks[i].done=cb.checked;save('tasks',tasks);renderTasks()};const s=document.createElement('span');s.textContent=t.text;s.style.textDecoration=t.done?'line-through':'none';s.style.opacity=t.done?'.55':'1';const b=document.createElement('button');b.textContent='×';b.onclick=()=>{tasks.splice(i,1);save('tasks',tasks);renderTasks()};r.append(cb,s,b);root.append(r)})}
function addTask(){const v=$('taskInput').value.trim();if(!v)return;tasks.unshift({text:v,done:false});save('tasks',tasks);$('taskInput').value='';renderTasks()}$('addTaskBtn').onclick=addTask;$('taskInput').onkeydown=e=>{if(e.key==='Enter')addTask()};
$('refreshAdmin').onclick=refreshAdmin;
function renderSettings(){$('tone').value=['casual','calm','funny','direct'].includes(prefs.tone)?prefs.tone:'casual';$('energy').value=Math.max(0,Math.min(100,Number(prefs.energy??70)));$('energyValue').textContent=$('energy').value+' %';$('nickname').value=prefs.nickname||'';$('speakReplies').checked=prefs.speakReplies!==false;$('profileName').textContent=prefs.nickname||user?.email||'IZZY AI'}
async function updateAuthUI(){const {data,error}=await sb.auth.getSession();if(error)throw error;if(recoveryMode)return;session=data.session;user=session?.user||null;if(!user){$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');return}loadUserData();renderSettings();$('profileEmail').textContent=user.email||'Compte connecté';$('authScreen').classList.add('hidden');$('app').classList.remove('hidden');renderHistory();renderChat();renderProjects();renderTasks();renderMemories();await checkServer();await checkAdmin()}
const frErr=m=>{m=String(m||'');if(/invalid login credentials/i.test(m))return 'E-mail ou mot de passe incorrect.';if(/email not confirmed/i.test(m))return 'Adresse e-mail pas encore confirmée. Ouvre le lien reçu par e-mail.';if(/rate limit|too many/i.test(m))return 'Trop de tentatives. Patiente quelques minutes puis réessaie.';if(/already registered/i.test(m))return 'Cette adresse a déjà un compte. Connecte-toi.';if(/failed to fetch|network/i.test(m))return 'Connexion impossible. Vérifie ton réseau puis réessaie.';return m||'Connexion impossible. Réessaie.'};
const emailField=()=>[$('authEmail'),document.querySelector('label[for="authEmail"]')];
$('authToggle').onclick=()=>{authMode=authMode==='login'?'signup':'login';$('authSubmit').textContent=authMode==='login'?'Se connecter':'Créer mon compte';$('authToggle').textContent=authMode==='login'?'Créer un compte':'J’ai déjà un compte';$('authSubtitle').textContent=authMode==='login'?'Connecte-toi à ton compagnon intelligent.':'Crée ton compte IZZY AI avec ton e-mail.';$('authPassword').setAttribute('autocomplete',authMode==='login'?'current-password':'new-password');$('authError').textContent=''};
$('authForm').addEventListener('submit',async e=>{e.preventDefault();const email=$('authEmail').value.trim(),password=$('authPassword').value;$('authSubmit').disabled=true;$('authError').textContent='';try{let result;if(recoveryMode){if(password.length<8)throw Error('Le nouveau mot de passe doit contenir au moins 8 caractères.');const {error}=await sb.auth.updateUser({password});if(error)throw error;$('authError').textContent='Mot de passe modifié. Tu peux maintenant te connecter.';recoveryMode=false;await sb.auth.signOut();authMode='login';$('authSubmit').textContent='Se connecter';$('authToggle').classList.remove('hidden');$('forgotBtn').classList.remove('hidden');$('authToggle').textContent='Créer un compte';$('authPasswordLabel').textContent='Mot de passe';$('authPassword').value='';$('authPassword').setAttribute('autocomplete','current-password');$('authSubtitle').textContent='Connecte-toi à ton compagnon intelligent.';$('authEmail').required=true;emailField().forEach(x=>x&&x.classList.remove('hidden'));return}if(authMode==='signup')result=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});else result=await sb.auth.signInWithPassword({email,password});if(result.error)throw result.error;if(authMode==='signup'){const u=result.data.user;if(u&&Array.isArray(u.identities)&&u.identities.length===0)throw Error('Cette adresse a déjà un compte. Connecte-toi ou utilise « Mot de passe oublié ? ».');if(!result.data.session){$('authError').textContent='Compte créé. Ouvre le lien de confirmation reçu par e-mail, puis reviens te connecter.';return}}await updateAuthUI()}catch(err){$('authError').textContent=frErr(err.message)}finally{$('authSubmit').disabled=false}});
$('forgotBtn').onclick=async()=>{const email=$('authEmail').value.trim();if(!email){$('authError').textContent='Saisis ton adresse e-mail dans le champ ci-dessus.';$('authEmail').focus();return}$('authError').textContent='Envoi en cours…';try{const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin});if(error)throw error;$('authError').textContent='Si cette adresse est enregistrée, un e-mail de réinitialisation va être envoyé. Ouvre le lien sur cet appareil.'}catch(e){$('authError').textContent=frErr(e.message)}};
$('signOutBtn').onclick=async()=>{try{await sb.auth.signOut()}catch{}session=null;user=null;isAdmin=false;$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');$('authEmail').value='';$('authPassword').value='';$('authError').textContent='Tu es déconnecté.';if('speechSynthesis'in window)speechSynthesis.cancel()};
sb.auth.onAuthStateChange((_event,newSession)=>{session=newSession;user=newSession?.user||null;if(_event==='PASSWORD_RECOVERY'){recoveryMode=true;$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');$('authSubtitle').textContent='Choisis un nouveau mot de passe pour ton compte.';$('authPasswordLabel').textContent='Nouveau mot de passe';$('authPassword').value='';$('authPassword').setAttribute('autocomplete','new-password');$('authPassword').setAttribute('placeholder','8 caractères minimum');$('authSubmit').textContent='Enregistrer le nouveau mot de passe';$('authToggle').classList.add('hidden');$('forgotBtn').classList.add('hidden');$('authEmail').required=false;emailField().forEach(x=>x&&x.classList.add('hidden'));$('authError').textContent='';return}if(recoveryMode)return;setTimeout(()=>updateAuthUI().catch(e=>{$('authError').textContent=e.message||'Erreur de session'}),0)});
updateAuthUI().catch(e=>{$('authError').textContent='Erreur Supabase : '+(e.message||'connexion impossible');$('authScreen').classList.remove('hidden');$('app').classList.add('hidden')});
})();
