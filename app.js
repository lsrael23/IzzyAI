(()=>{'use strict';
const $=id=>document.getElementById(id);
const API='https://izzyai.onrender.com';
const SUPABASE_URL='https://xtulmimrbvzokvrglken.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_nWnm3EA3f4qAsh-RVIkyqA_-FtTBrE0';
const ADMIN_USER_ID='c1086e22-ff59-48ba-a1f2-f46bcfed6a91';
if(!window.supabase){$('authError').textContent='Impossible de charger le client Supabase. Vérifie ta connexion puis recharge la page.';return}
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:t
rue}});
const K={prefs:'izzyAI.prefs.v1',memories:'izzyAI.memories.v1',chats:'izzyAI.chats.v2',projects:'izzyAI.projects.v1',tasks:'izzyAI.tasks.v1',acti
ve:'izzyAI.activeChat.v2'};
const read=(k,d)=>{try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch{return
d}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
const uid=()=>crypto?.randomUUID?.()||'izzy-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
let session=null,user=null,isAdmin=false,authMode='login',recoveryMode=false,chats=[],projects=[],tasks=[],memories=[],activeId='',sending=false,
selectedImageData=null,webSearch=false,voiceOn=true,lastUserMessage='',lastAssistantMessage='',toastTimer,prefs={tone:'casual',energy:70,nickname
:'',speakReplies:true};
function toast(t){const
n=$('toast');n.textContent=t;n.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.classList.add('hidden'),2400)}
function setStatus(t,k=''){const n=$('status');n.textContent=t;n.className='status'+(k?' '+k:'')}
function userKey(k){return 'izzyAI.user.'+(user?.id||'signedout')+'.'+k}
function loadUserData(){prefs=read(userKey('prefs'),read(K.prefs,{tone:'casual',energy:70,nickname:'',speakReplies:true}));memories=read(userKey(
'memories'),read(K.memories,[]));chats=read(userKey('chats'),read(K.chats,[]));projects=read(userKey('projects'),read(K.projects,[]));tasks=read(
userKey('tasks'),read(K.tasks,[]));if(!Array.isArray(chats))chats=[];if(!Array.isArray(projects))projects=[];if(!Array.isArray(tasks))tasks=[];if
(!Array.isArray(memories))memories=[];memories=memories.filter(x=>typeof
x==='string').slice(0,50);activeId=localStorage.getItem(userKey('active'))||''}
function save(k,v){write(userKey(k),v);/* legacy keys are not overwritten; old data stays on this device */ }
function currentChat(){return chats.find(c=>c.id===activeId)||null}
function newChat(){const c={id:uid(),title:'Nouveau chat',updatedAt:Date.now(),messages:[]};chats.unshift(c);activeId=c.id;save('chats',chats);lo
calStorage.setItem(userKey('active'),activeId);renderHistory();showPanel('chat');renderChat();closeMenu();$('messageInput').focus()}
function saveChats(){save('chats',chats);localStorage.setItem(userKey('active'),activeId);renderHistory()}
function updateChatTitle(c){if(c&&c.title==='Nouveau chat'){const f=c.messages.find(m=>m.role==='user');if(f)c.title=f.text.replace(/\s+/g,'
').slice(0,42)+(f.text.length>42?'…':'')}}
function renderHistory(){const root=$('historyList'),q=$('historySearch').value.trim().toLowerCase();root.replaceChildren();const list=[...chats]
.sort((a,b)=>b.updatedAt-a.updatedAt).filter(c=>(c.title||'').toLowerCase().includes(q)||c.messages.some(m=>(m.text||'').toLowerCase().includes(q
)));if(!list.length){const p=document.createElement('p');p.className='small-note';p.style.padding='0 8px';p.textContent=q?'Aucun résultat.':'Tes
conversations apparaîtront ici.';root.append(p);return}list.slice(0,50).forEach(c=>{const
b=document.createElement('button');b.className='history-item'+(c.id===activeId?' active':'');const s=document.createElement('span');s.textContent
=c.title||'Conversation';b.append(s);b.onclick=()=>{activeId=c.id;localStorage.setItem(userKey('active'),activeId);renderHistory();showPanel('cha
t');renderChat();closeMenu()};const d=document.createElement('button');d.className='del';d.textContent='×';d.setAttribute('aria-label','Supprimer
cette conversation');d.onclick=e=>{e.stopPropagation();if(confirm('Supprimer cette conversation de cet appareil ?')){chats=chats.filter(x=>x.id!
==c.id);if(activeId===c.id)activeId='';saveChats();if(!activeId&&chats.length)activeId=chats[0].id;if(!activeId)newChat();else{localStorage.setIt
em(userKey('active'),activeId);renderHistory();renderChat()}}};b.append(d);root.append(b)})}
function showPanel(name){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('[data-panel]').f
orEach(b=>b.classList.toggle('active',b.dataset.panel===name));const panel=$(name==='chat'?'chatPanel':name+'Panel');if(panel)panel.classList.add
('active');$('currentTitle').textContent=name==='chat'?(currentChat()?.title||'Nouveau
chat'):({projects:'Projets',tasks:'Tâches',settings:'Paramètres',memories:'Ma mémoire',admin:'Administration'}[name]||'IZZY AI');if(name==='proje
cts')renderProjects();if(name==='tasks')renderTasks();if(name==='memories')renderMemories();if(name==='admin')refreshAdmin();closeMenu()}
function closeMenu(){$('sidebar').classList.remove('open');$('overlay').classList.remove('show')}
function cleanText(src){return String(src??'').replace(/\r/g,'').replace(/\\\[|\\\]/g,'').replace(/\\\(|\\\)/g,'').replace(/\\(?:text|mathrm|math
bf)\{([^{}]*)\}/g,'$1').replace(/\\(?:times|cdot)/g,' × ').replace(/\\(?:div)/g,' ÷ ').replace(/\\(?:leq|le)/g,'≤').replace(/\\(?:geq|ge)/g,'≥').
replace(/\\neq/g,'≠').replace(/\\approx/g,'≈').replace(/\\rightarrow|\\Longrightarrow|\\to/g,' → ').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,'($
1)/($2)').replace(/\$\$([\s\S]*?)\$\$/g,'$1').replace(/\$([^$\n]+)\$/g,'$1').replace(/\\begin\{[^}]+\}|\\end\{[^}]+\}/g,'').replace(/\\[,;!]/g,'
').replace(/\\[a-zA-Z]+/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
function inline(parent,text){const re=/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;let
pos=0,m;while((m=re.exec(text))){if(m.index>pos)parent.append(document.createTextNode(text.slice(pos,m.index)));const t=m[0];let
el;if(t[0]==='['){const z=t.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(z){el=document.createElement('a');el.textContent=z[1];el.href=z[2]
;el.target='_blank';el.rel='noopener noreferrer'}}else if(t[0]==='`'){el=document.createElement('code');el.textContent=t.slice(1,-1)}else if(t.st
artsWith('**')||t.startsWith('__')){el=document.createElement('strong');el.textContent=t.slice(2,-2)}else{el=document.createElement('em');el.text
Content=t.slice(1,-1)}parent.append(el||document.createTextNode(t));pos=re.lastIndex}if(pos<text.length)parent.append(document.createTextNode(tex
t.slice(pos)))}
function renderAnswer(root,raw){root.replaceChildren();const lines=cleanText(raw).split('\n');let para=[],list=null,code=false,codeLines=[];const
flushP=()=>{if(!para.length)return;const p=document.createElement('p');inline(p,para.join('
'));root.append(p);para=[]},flushL=()=>{if(list){root.append(list);list=null}},flushC=()=>{const pre=document.createElement('pre'),c=document.cre
ateElement('code');c.textContent=codeLines.join('\n');pre.append(c);root.append(pre);codeLines=[]};for(const line of
lines){if(line.trim().startsWith('```')){flushP();flushL();if(code){flushC();code=false}elsecode=true;continue}if(code){codeLines.push(line);continue}if(!line.trim()){flushP();flushL();continue}const
item=line.match(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/);if(item){flushP();const
tag=/^\s*\d+[.)]\s+/.test(line)?'ol':'ul';if(!list||list.tagName.toLowerCase()!==tag){flushL();list=document.createElement(tag)}const
li=document.createElement('li');inline(li,line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/,''));list.append(li);continue}flushL();const
h=line.match(/^#{1,3}\s+(.+)$/);if(h){flushP();const
el=document.createElement('h3');inline(el,h[1]);root.append(el);continue}if(/^>\s?/.test(line)){flushP();const q=document.createElement('blockquo
te');inline(q,line.replace(/^>\s?/,''));root.append(q);continue}if(/^---+$/.test(line.trim())){flushP();root.append(document.createElement('hr'))
;continue}para.push(line.trim())}if(code)flushC();flushP();flushL()}
function addMessage(text,role,opts={}){const chat=currentChat();if(!chat)return null;const
row=document.createElement('div');row.className='message-row '+role;const
av=document.createElement('div');av.className='avatar';av.textContent=role==='ai'?'I':'T';const
body=document.createElement('div');body.className='message-body';if(role==='ai')renderAnswer(body,text);else
body.textContent=text;row.append(av,body);$('messages').append(row);if(role==='ai'&&opts.actions!==false){const
acts=document.createElement('div');acts.className='message-actions';[['Copier','copy'],['Lire','read'],['Partager','share'],['Nouveau chat depuis
ici','branch'],['Réessayer','retry']].forEach(([label,act])=>{const b=document.createElement('button');b.textContent=label;b.onclick=()=>message
Action(act,text);acts.append(b)});body.append(acts)}if(opts.store!==false){chat.messages.push({role,text:String(text),at:Date.now()});chat.update
dAt=Date.now();updateChatTitle(chat);saveChats();$('currentTitle').textContent=chat.title}if(role==='ai')lastAssistantMessage=text;$('messages').
scrollTop=$('messages').scrollHeight;return row}
function renderChat(){const root=$('messages');root.replaceChildren();let
chat=currentChat();$('welcome').classList.toggle('hidden',!!chat?.messages?.length);if(!chat){chat={id:uid(),title:'Nouveau chat',updatedAt:Date.
now(),messages:[]};chats.unshift(chat);activeId=chat.id;saveChats()}chat.messages.forEach(m=>addMessage(m.text,m.role,{store:false,actions:m.role
==='ai',at:m.at}));$('currentTitle').textContent=chat.title||'Nouveau chat';root.scrollTop=root.scrollHeight}
function speak(text){if(!voiceOn||!$('speakReplies').checked||!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new
SpeechSynthesisUtterance(cleanText(text).replace(/https?:\/\/\S+/g,' lien web '));u.lang='fr-FR';u.rate=.98;speechSynthesis.speak(u)}
async function messageAction(action,text){if(action==='copy'){try{await navigator.clipboard.writeText(cleanText(text));toast('Réponse
copiée')}catch{toast('Copie non disponible')}return}if(action==='read'){speak(text);return}if(action==='share'){try{if(navigator.share)await
navigator.share({title:'Réponse IZZY AI',text:cleanText(text)});else{await navigator.clipboard.writeText(cleanText(text));toast('Texte
copié')}}catch{}return}if(action==='retry'){const
last=[...(currentChat()?.messages||[])].reverse().find(m=>m.role==='user');if(last){$('messageInput').value=last.text;await
send(true)}return}if(action==='branch'){const
old=[...(currentChat()?.messages||[])];newChat();old.slice(-4).forEach(m=>addMessage(m.text,m.role));const
last=[...old].reverse().find(m=>m.role==='user');if(last){$('messageInput').value='Continue cette discussion à partir de ce contexte
:\n'+last.text;$('messageInput').focus()}toast('Nouveau chat créé avec le contexte récent')}}
function preferences(){return{tone:$('tone').value,energy:Number($('energy').value),nickname:$('nickname').value.trim().slice(0,32),speakReplies:
$('speakReplies').checked,memories:memories.slice(0,50)}}
function clearPhoto(){selectedImageData=null;$('attachImage').removeAttribute('src');$('attachPreview').classList.remove('visible');$('cameraInpu
t').value='';$('galleryInput').value=''}
function preparePhoto(file){if(!file)return;if(!file.type.startsWith('image/'))return toast('Choisis une image
valide');if(file.size>15*1024*1024)return toast('Image trop lourde : maximum 15 Mo');const reader=new FileReader();reader.onload=()=>{const
img=new Image();img.onload=()=>{const scale=Math.min(1,1280/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=
Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const ctx=canvas.getContext('2d');if(!ctx)return;c
tx.drawImage(img,0,0,canvas.width,canvas.height);selectedImageData=canvas.toDataURL('image/jpeg',.78);$('attachImage').src=selectedImageData;$('a
ttachPreview').classList.add('visible')};img.src=reader.result};reader.readAsDataURL(file)}
$('cameraBtn').onclick=()=>$('cameraInput').click();$('galleryBtn').onclick=()=>$('galleryInput').click();$('cameraInput').onchange=e=>preparePho
to(e.target.files?.[0]);$('galleryInput').onchange=e=>preparePhoto(e.target.files?.[0]);$('removeImageBtn').onclick=clearPhoto;
async function authFetch(path,options={}){if(!session?.access_token)throw Error('Ta session a expiré. Reconnecte-toi.');const
headers={...(options.headers||{}),Authorization:'Bearer '+session.access_token};return fetch(API+path,{...options,headers})}
async function checkServer(){try{const r=await fetch(API+'/health',{cache:'no-store'});const d=await r.json();if(!r.ok||d.status!=='ok')throw
Error();setStatus('l Serveur connecté','good')}catch{setStatus('l Serveur à vérifier','bad')}}
async function checkAdmin(){isAdmin=false;try{const r=await authFetch('/admin/me',{cache:'no-store'});const d=await r.json();isAdmin=!!(r.ok&&d.i
sAdmin&&user&&user.id===ADMIN_USER_ID)}catch{}$('adminBtn').classList.toggle('hidden',!isAdmin);$('adminTag').classList.toggle('hidden',!isAdmin)
;if(!isAdmin&&$('adminPanel').classList.contains('active'))showPanel('chat')}
async function refreshAdmin(){if(!isAdmin)return;const
el=$('adminHealth');el.textContent='Vérification…';$('adminAccount').textContent=user?.email||user?.id||'';try{const r=await
authFetch('/health',{cache:'no-store'});const d=await r.json();el.textContent=r.ok&&d.status==='ok'?'Serveur opérationnel • Supabase :
'+(d.supabaseConfigured?'connecté':'non configuré')+' • IA : '+(d.aiConfigured?'configurée':'non configurée'):'État serveur à
vérifier'}catch{el.textContent='Impossible de joindre le serveur.'}}
async function send(retry=false){if(sending)return;if(!session?.access_token)return toast('Connecte-toi pour envoyer un message');const
input=$('messageInput'),raw=input.value.trim(),image=selectedImageData;if(!raw&&!image)return;const message=raw||'Analyse cette image et
explique-moi ce que tu observes.';if(!retry){addMessage(message+(image?'\n[Photo jointe]':''),'user');lastUserMessage=message}input.value='';inpu
t.style.height='auto';$('welcome').classList.add('hidden');sending=true;$('sendBtn').disabled=true;$('typing').classList.remove('hidden');const
pref=preferences();prefs=pref;save('prefs',{tone:pref.tone,energy:pref.energy,nickname:pref.nickname,speakReplies:pref.speakReplies});try{const e
ndpoint=image?'/vision':'/chat',payload={message,conversationId:activeId,preferences:pref};if(image)payload.imageData=image;if(webSearch&&!image)
payload.webSearch=true;const r=await authFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),s
ignal:AbortSignal.timeout(90000)});const ct=r.headers.get('content-type')||'';const data=ct.includes('application/json')?await
r.json():{error:(await r.text()).slice(0,180)};if(!r.ok)throw Error(data.error||'Erreur HTTP '+r.status);if(typeof
data.reply!=='string'||!data.reply.trim())throw Error('Le serveur n’a pas renvoyé de
réponse.');addMessage(data.reply,'ai');speak(data.reply);if(image)clearPhoto();setStatus('l Serveur connecté','good')}catch(e){addMessage('Je
n’arrive pas à répondre pour le moment. '+(e.message&&!e.message.includes('Failed to fetch')?e.message:'Vérifie la connexion au serveur puis
réessaie.'),'ai');setStatus('l Connexion à
vérifier','bad')}finally{sending=false;$('sendBtn').disabled=false;$('typing').classList.add('hidden')}}
$('sendBtn').onclick=()=>send();$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});$(
'messageInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,160)+'px'});
$('webBtn').onclick=()=>{webSearch=!webSearch;$('webBtn').classList.toggle('active',webSearch);$('webBtn').setAttribute('aria-pressed',String(webSearch));toast(webSearch?'Recherche web activée pour le prochain message':'Recherche web
désactivée')};$('voiceBtn').onclick=()=>{voiceOn=!voiceOn;$('voiceBtn').textContent=voiceOn?'n Voix activée':'n Voix
coupée';if(!voiceOn&&'speechSynthesis'in window)speechSynthesis.cancel()};$('stopBtn').onclick=()=>{if('speechSynthesis'in
window)speechSynthesis.cancel()};$('newChatBtn').onclick=newChat;$('topNewChat').onclick=newChat;
$('clearChatBtn').onclick=()=>{const c=currentChat();if(!c||!c.messages.length)return toast('Cette conversation est déjà
vide');if(confirm('Effacer les messages de cette conversation ?')){c.messages=[];c.title='Nouveau
chat';c.updatedAt=Date.now();saveChats();renderChat();toast('Conversation effacée')}};
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.panel==='admin'&&!isAdmin)return toast('Accès
administrateur refusé');showPanel(b.dataset.panel)}));$('menuBtn').onclick=()=>{$('sidebar').classList.add('open');$('overlay').classList.add('sh
ow')};$('overlay').onclick=closeMenu;$('searchChatsBtn').onclick=()=>{$('historySearchWrap').classList.toggle('hidden');$('historySearch').focus(
);renderHistory()};$('historySearch').oninput=renderHistory;
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('messageInput').value=b.dataset.prompt;send()}));
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;$('micBtn').onclick=()=>{if(!SR)return toast('La saisie vocale n’est pas
disponible ici');const rec=new SR();rec.lang='fr-FR';rec.interimResults=false;rec.onresult=e=>{$('messageInput').value=e.results[0][0].transcript
;send()};rec.onerror=()=>toast('Autorise le micro dans Safari');rec.start();toast('Je t’écoute…')};
$('energy').oninput=()=>$('energyValue').textContent=$('energy').value+' %';$('savePersonality').onclick=()=>{const p=preferences();prefs=p;save(
'prefs',{tone:p.tone,energy:p.energy,nickname:p.nickname,speakReplies:p.speakReplies});$('profileName').textContent=p.nickname||user?.email||'IZZ
Y AI';toast('Réglages enregistrés')};
function renderMemories(){const root=$('memoryList');root.replaceChildren();if(!memories.length){root.textContent='Aucun souvenir pour le
moment.';root.className='list-items small-note';return}root.className='list-items';memories.forEach((m,i)=>{const
row=document.createElement('div');row.className='list-item';const s=document.createElement('span');s.textContent=m;const b=document.createElement
('button');b.textContent='Supprimer';b.onclick=()=>{memories.splice(i,1);save('memories',memories);renderMemories()};row.append(s,b);root.append(
row)})}
function addMemory(){const v=$('memoryInput').value.trim();if(!v)return;if(memories.length>=50)return toast('Maximum 50
souvenirs');memories.push(v);save('memories',memories);$('memoryInput').value='';renderMemories();toast('Souvenir enregistré sur cet appareil')}
$('addMemory').onclick=addMemory;$('memoryInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addMemory()}};$('deleteMemory').onclick=()
=>{if(confirm('Effacer tous les souvenirs de ce compte sur cet appareil
?')){memories=[];save('memories',memories);renderMemories()}};$('exportMemory').onclick=()=>{const
a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(memories,null,2)],{type:'application/json'}));a.href=url;a.downloa
d='izzy-ai-souvenirs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
function renderProjects(){const root=$('projectsList');root.replaceChildren();if(!projects.length){root.textContent='Aucun projet pour le
moment.';root.className='list-items small-note';return}root.className='list-items';projects.forEach((p,i)=>{const
r=document.createElement('div');r.className='list-item';const s=document.createElement('span');s.textContent=p;const b=document.createElement('bu
tton');b.textContent='Supprimer';b.onclick=()=>{projects.splice(i,1);save('projects',projects);renderProjects()};r.append(s,b);root.append(r)})}
function addProject(){const v=$('projectInput').value.trim();if(!v)return;projects.unshift(v);save('projects',projects);$('projectInput').value='
';renderProjects()}$('addProjectBtn').onclick=addProject;$('projectInput').onkeydown=e=>{if(e.key==='Enter')addProject()};
function renderTasks(){const root=$('tasksList');root.replaceChildren();if(!tasks.length){root.textContent='Aucune tâche pour le
moment.';root.className='list-items small-note';return}root.className='list-items';tasks.forEach((t,i)=>{const
r=document.createElement('div');r.className='list-item';const
cb=document.createElement('input');cb.type='checkbox';cb.checked=!!t.done;cb.setAttribute('aria-label','Tâche
terminée');cb.onchange=()=>{tasks[i].done=cb.checked;save('tasks',tasks);renderTasks()};const
s=document.createElement('span');s.textContent=t.text;s.style.textDecoration=t.done?'line-through':'none';s.style.opacity=t.done?'.55':'1';const
b=document.createElement('button');b.textContent='×';b.onclick=()=>{tasks.splice(i,1);save('tasks',tasks);renderTasks()};r.append(cb,s,b);root.ap
pend(r)})}
function addTask(){const v=$('taskInput').value.trim();if(!v)return;tasks.unshift({text:v,done:false});save('tasks',tasks);$('taskInput').value='
';renderTasks()}$('addTaskBtn').onclick=addTask;$('taskInput').onkeydown=e=>{if(e.key==='Enter')addTask()};
$('refreshAdmin').onclick=refreshAdmin;
function renderSettings(){ $('tone').value=['casual','calm','funny','direct'].includes(prefs.tone)?prefs.tone:'casual';$('energy').value=Math.max
(0,Math.min(100,Number(prefs.energy??70)));$('energyValue').textContent=$('energy').value+' %';$('nickname').value=prefs.nickname||'';$('speakRep
lies').checked=prefs.speakReplies!==false;$('profileName').textContent=prefs.nickname||user?.email||'IZZY AI';}
async function updateAuthUI(){const {data,error}=await sb.auth.getSession();if(error)throw error;session=data.session;user=session?.user||null;if
(!user){$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');return}loadUserData();renderSettings();$('profileEmail').text
Content=user.email||'Compte connecté';$('authScreen').classList.add('hidden');$('app').classList.remove('hidden');renderHistory();renderChat();re
nderProjects();renderTasks();renderMemories();await checkServer();await checkAdmin()}
$('authToggle').onclick=()=>{authMode=authMode==='login'?'signup':'login';$('authSubmit').textContent=authMode==='login'?'Se connecter':'Créer
mon compte';$('authToggle').textContent=authMode==='login'?'Créer un compte':'J’ai déjà un
compte';$('authSubtitle').textContent=authMode==='login'?'Connecte-toi à ton compagnon intelligent.':'Crée ton compte IZZY AI avec ton
e-mail.';$('authPassword').setAttribute('autocomplete',authMode==='login'?'current-password':'new-password');$('authError').textContent=''};
$('authForm').addEventListener('submit',async e=>{e.preventDefault();const
email=$('authEmail').value.trim(),password=$('authPassword').value;$('authSubmit').disabled=true;$('authError').textContent='';try{let
result;if(recoveryMode){if(password.length<8)throw Error('Le nouveau mot de passe doit contenir au moins 8 caractères.');const {error}=await
sb.auth.updateUser({password});if(error)throw error;$('authError').textContent='Mot de passe modifié. Tu peux maintenant te
connecter.';recoveryMode=false;await sb.auth.signOut();authMode='login';$('authSubmit').textContent='Se
connecter';$('authToggle').classList.remove('hidden');$('forgotBtn').classList.remove('hidden');$('authToggle').textContent='Créer un
compte';$('authPasswordLabel').textContent='Mot de
passe';$('authPassword').value='';$('authPassword').setAttribute('autocomplete','current-password');$('authSubtitle').textContent='Connecte-toi à
ton compagnon intelligent.';return}if(authMode==='signup')result=await
sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});else result=await
sb.auth.signInWithPassword({email,password});if(result.error)throw
result.error;if(authMode==='signup'&&!result.data.session){$('authError').textContent='Compte créé. Ouvre le lien de confirmation reçu par
e-mail, puis reviens te connecter.';return}await updateAuthUI()}catch(err){$('authError').textContent=err.message||'Connexion impossible.
Réessaie.'}finally{$('authSubmit').disabled=false}});
$('forgotBtn').onclick=async()=>{const email=$('authEmail').value.trim();if(!email){$('authError').textContent='Saisis ton adresse e-mail dans le
champ ci-dessus.';$('authEmail').focus();return}try{const {error}=await
hScreen').classList.remove('hidden');$('authEmail').value='';$('authPassword').value='';$('authError').textContent='Tu es
déconnecté.';if('speechSynthesis'in window)speechSynthesis.cancel()};
sb.auth.onAuthStateChange((_event,newSession)=>{session=newSession;user=newSession?.user||null;if(_event==='PASSWORD_RECOVERY'){recoveryMode=true
;$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');$('authSubtitle').textContent='Choisis un nouveau mot de passe pour
ton compte.';$('authPasswordLabel').textContent='Nouveau mot de
passe';$('authPassword').value='';$('authPassword').setAttribute('autocomplete','new-password');$('authPassword').setAttribute('placeholder','8
caractères minimum');$('authSubmit').textContent='Enregistrer le nouveau mot de passe';$('authToggle').classList.add('hidden');$('forgotBtn').cla
ssList.add('hidden');$('authError').textContent='';return}if(recoveryMode)return;setTimeout(()=>updateAuthUI().catch(e=>{$('authError').textConte
nt=e.message||'Erreur de session'}),0)});
updateAuthUI().catch(e=>{$('authError').textContent='Erreur Supabase : '+(e.message||'connexion
impossible');$('authScreen').classList.remove('hidden');$('app').classList.add('hidden')});
