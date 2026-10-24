// Sync MM2 — Vercel port (Milestone 1). State lives in Upstash Redis; a Redis lock serialises every write.
const crypto=require('crypto');
const ADMINS=(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
const URL_=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,TOK=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const R=async(...c)=>{const r=await fetch(URL_,{method:'POST',headers:{Authorization:'Bearer '+TOK},body:JSON.stringify(c)});const j=await r.json();if(j.error)throw Error('DB: '+j.error);return j.result};
const ITEMS=[['luger','Luger','gun',10,'🔫'],['chromaluger','Chroma Luger','gun',120,'🔫'],['icepiercer','Icepiercer','knife',45,'🗡️'],
['batwing','Batwing','knife',60,'🦇'],['gingerscope','Gingerscope','gun',90,'🍬'],['harvester','Harvester','knife',300,'⚔️'],
['elderwood','Elderwood Scythe','knife',150,'🌿'],['corrupt','Corrupt','knife',220,'💀'],['heartblade','Heartblade','knife',80,'💖'],
['eternal','Eternal','knife',500,'♾️'],['vampire','Vampire\'s Edge','knife',35,'🧛'],['seer','Chroma Seer','knife',180,'🔮'],
['pet1','Pet Cat','pet',5,'🐱'],['pet2','Pet Dragon','pet',70,'🐲']].map(([id,name,type,value,icon])=>({id,name,type,value,icon}));
const I=Object.fromEntries(ITEMS.map(i=>[i.id,i]));
let db,jp,hooks=[];
const load=async()=>{const s=await R('GET','db');db={users:{},sessions:{},shop:{},wd:[],values:{},webhook:'',logs:[],jp:null,...(s?JSON.parse(s):{})};
 jp=db.jp||(db.jp={players:{},end:0,id:0,last:null})};
const persist=()=>R('SET','db',JSON.stringify(db));
const save=()=>{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function mutate(fn){const t=crypto.randomBytes(8).toString('hex');let ok=0;
 for(let i=0;i<60&&!ok;i++){if(await R('SET','lock',t,'NX','PX',9000)==='OK')ok=1;else await sleep(100)}
 if(!ok)throw Error('Server busy, try again');
 try{await load();if(jp.end&&Date.now()>=jp.end)jpResolve();const out=await fn();await persist();return out}
 finally{if(await R('GET','lock')===t)await R('DEL','lock')}}
const val=id=>db.values[id]??I[id].value;
const invVal=u=>Object.entries(u.inv).reduce((s,[k,q])=>s+val(k)*q,0);
const add=(o,k,q)=>{o[k]=(o[k]||0)+q;if(o[k]<=0)delete o[k]};
const log=m=>{db.logs.push([Date.now(),m]);db.logs=db.logs.slice(-100);const w=db.webhook||process.env.WEBHOOK_URL;
 if(w)hooks.push(fetch(w,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:String(m).slice(0,1900)})}).catch(()=>{}))};
const E=m=>{throw Error(m)};
const rj=async(u,o)=>{const r=await fetch(u,o);if(!r.ok)E('Roblox API error, try again');return r.json()};
const WORDS='apple tiger moon river frost ember cloud maple storm pearl cobra delta falcon jade lotus nova onyx pixel quartz raven solar tulip vivid zebra'.split(' ');
const needInt=(n,min=1)=>{n=Math.floor(+n);if(!(n>=min))E('Invalid amount');return n};
const findUser=s=>db.users[s]||Object.values(db.users).find(u=>u.name.toLowerCase()===String(s).toLowerCase())||E('User not found');

// ---- Jackpot (resolved lazily by the next request after the timer ends) ----
const jpPub=()=>{const t=Object.values(jp.players).reduce((s,p)=>s+p.value,0);
 return{now:Date.now(),end:jp.end,total:t,last:jp.last,players:Object.entries(jp.players).map(([id,p])=>({id,name:p.name,avatar:p.avatar,value:p.value,pct:t?p.value/t*100:0,items:p.items}))}};
function jpRefund(){for(const[id,p]of Object.entries(jp.players))for(const[k,q]of Object.entries(p.items))add(db.users[id].inv,k,q);jp.players={};jp.end=0}
function jpResolve(){
 const P=Object.entries(jp.players);if(!P.length){jp.end=0;return}const total=P.reduce((s,[,p])=>s+p.value,0);
 let r=Math.random()*total,w=P[0];for(const e of P){if((r-=e[1].value)<0){w=e;break}}
 const pot={};P.forEach(([,p])=>Object.entries(p.items).forEach(([k,q])=>add(pot,k,q)));
 const units=[];Object.entries(pot).forEach(([k,q])=>{for(let i=0;i<q;i++)units.push(k)});
 units.sort((x,y)=>val(x)-val(y));let s=0;const cap=total*.1,tax=[];
 for(const k of units){if(s+val(k)<=cap){s+=val(k);tax.push(k)}else break}
 tax.forEach(k=>{add(pot,k,-1);add(db.shop,k,1)});
 const wu=db.users[w[0]];Object.entries(pot).forEach(([k,q])=>add(wu.inv,k,q));
 const got=total-s;
 P.forEach(([id,p])=>{const u=db.users[id];u.wagered+=p.value;u.profit+=(id===w[0]?got:0)-p.value});
 jp.last={rid:++jp.id,t:Date.now(),winner:w[0],name:w[1].name,total,taxed:s,snap:P.map(([id,p])=>({id,name:p.name,value:p.value}))};
 jp.players={};jp.end=0;log(`🎰 Jackpot #${jp.id}: **${w[1].name}** won ${got} value (pot ${total}, tax ${s})`)}
const mult=(m,n)=>{let x=.97;for(let k=0;k<n;k++)x*=(25-k)/(25-m-k);return x};

async function start(b){
 const d=await rj('https://users.roblox.com/v1/usernames/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({usernames:[String(b.username||'').trim()],excludeBannedUsers:true})});
 const p=d.data[0];if(!p)E('Roblox user not found');
 const w=()=>WORDS[crypto.randomInt(WORDS.length)],tok=crypto.randomBytes(16).toString('hex'),code=`Sync MM2 - ${w()} ${w()} ${w()}`;
 await R('SET','p:'+tok,JSON.stringify({id:String(p.id),name:p.name,code}),'EX',600);
 return{tok,code,name:p.name,exp:Date.now()+600000}}
async function check(b,H){
 const raw=await R('GET','p:'+b.tok);if(!raw)E('Code expired — start again');const p=JSON.parse(raw);
 const d=await rj(`https://users.roblox.com/v1/users/${p.id}`);if(!(d.description||'').includes(p.code))return{waiting:true};
 let av='';try{av=(await rj(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${p.id}&size=150x150&format=Png`)).data[0].imageUrl}catch{}
 return mutate(async()=>{const u=db.users[p.id]||(db.users[p.id]={id:p.id,name:p.name,avatar:'',tokens:0,inv:{},wagered:0,profit:0,mines:null});
  u.name=p.name;u.avatar=av;const s=crypto.randomBytes(24).toString('hex');db.sessions[s]=p.id;await R('DEL','p:'+b.tok);
  H['Set-Cookie']=`sid=${s}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`;log(`✅ ${p.name} logged in`);return{ok:true}})}

async function handle(a,b,sid,H){
 if(a==='lb'){const us=Object.values(db.users),f=k=>us.slice().sort((x,y)=>y[k]-x[k]).slice(0,20).map(u=>({name:u.name,avatar:u.avatar,v:Math.floor(u[k])}));
  return{wagered:f('wagered'),profit:f('profit')}}
 const u=db.users[db.sessions[sid]];
 if(a==='state'){
  if(!u)return{guest:true};const admin=ADMINS.includes(u.id),m=u.mines;
  return{me:{id:u.id,name:u.name,avatar:u.avatar,tokens:u.tokens,inv:u.inv,invValue:invVal(u),admin},
   items:ITEMS.map(i=>({...i,value:val(i.id)})),shop:db.shop,jp:jpPub(),
   mines:m&&{bet:m.bet,m:m.m,open:m.open,mult:mult(m.m,m.open.length)},
   wd:db.wd.filter(w=>w.uid===u.id).slice(-10),
   admin:admin?{wd:db.wd.filter(w=>w.status==='pending'),webhook:!!db.webhook,logs:db.logs.slice(-15)}:undefined}}
 if(!u)E('Please log in');
 if(a==='logout'){delete db.sessions[sid];return{ok:1}}
 const take=(items,types)=>{let v=0;for(const[k,q]of Object.entries(items||{})){const n=needInt(q);if(!I[k])E('Bad item');if(types&&!types.includes(I[k].type))E('Item not allowed here');if((u.inv[k]||0)<n)E('You do not own that');v+=val(k)*n}
  for(const[k,q]of Object.entries(items))add(u.inv,k,-q);return v};
 if(a==='sell'){const n=needInt(b.qty),v=take({[b.item]:n}),t=Math.floor(v*.9);u.tokens+=t;add(db.shop,b.item,n);log(`💱 ${u.name} sold ${n}x ${b.item} for ${t} tokens`);return{ok:1}}
 if(a==='buy'){const n=needInt(b.qty);if(!I[b.item]||(db.shop[b.item]||0)<n)E('Out of stock');const p=Math.ceil(val(b.item)*1.1)*n;
  if(u.tokens<p)E('Not enough tokens');u.tokens-=p;add(db.shop,b.item,-n);add(u.inv,b.item,n);log(`🛒 ${u.name} bought ${n}x ${b.item} for ${p}`);return{ok:1}}
 if(a==='jpjoin'){if(!b.items||!Object.keys(b.items).length)E('Select items');
  const v=take(b.items);const p=jp.players[u.id]||(jp.players[u.id]={name:u.name,avatar:u.avatar,items:{},value:0});
  for(const[k,q]of Object.entries(b.items))add(p.items,k,q);p.value+=v;
  if(Object.keys(jp.players).length>=2&&!jp.end)jp.end=Date.now()+25000;return{ok:1}}
 if(a==='jpleave'){const p=jp.players[u.id];if(!p||Object.keys(jp.players).length>1)E('Cannot leave now');for(const[k,q]of Object.entries(p.items))add(u.inv,k,q);delete jp.players[u.id];return{ok:1}}
 if(a==='minesstart'){if(u.mines)E('Game in progress');const bet=needInt(b.bet),m=needInt(b.m);if(m>10)E('Max 10 mines');if(u.tokens<bet)E('Not enough tokens');
  u.tokens-=bet;const mines=[];while(mines.length<m){const x=crypto.randomInt(25);if(!mines.includes(x))mines.push(x)}
  u.mines={bet,m,mines,open:[]};return{ok:1}}
 if(a==='minespick'){const g=u.mines;if(!g)E('No game');const i=needInt(b.i,0);if(i>24||g.open.includes(i))E('Invalid tile');
  if(g.mines.includes(i)){u.wagered+=g.bet;u.profit-=g.bet;u.mines=null;return{boom:true,mines:g.mines,open:g.open}}
  g.open.push(i);if(g.open.length===25-g.m)return minesCash(u);return{safe:true}}
 if(a==='minescash'){if(!u.mines||!u.mines.open.length)E('Pick a tile first');return minesCash(u)}
 if(a==='withdraw'){const n=needInt(b.qty);take({[b.item]:n},['gun','knife']);db.wd.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,item:b.item,qty:n,status:'pending',t:Date.now()});
  log(`📤 Withdraw request: ${u.name} ${n}x ${b.item}`);return{ok:1}}
 if(a.startsWith('adm')){if(!ADMINS.includes(u.id))E('Not admin');
  if(a==='admgive'){const t=findUser(b.user);if(!I[b.item])E('Bad item');add(t.inv,b.item,needInt(b.qty));log(`🛠️ ${u.name} gave ${b.qty}x ${b.item} to ${t.name}`)}
  else if(a==='admset'){const t=findUser(b.user);if(!I[b.item])E('Bad item');const q=Math.max(0,Math.floor(+b.qty));delete t.inv[b.item];if(q)t.inv[b.item]=q;log(`🛠️ ${u.name} set ${t.name}'s ${b.item} to ${q}`)}
  else if(a==='admtokens'){const t=findUser(b.user);t.tokens=Math.max(0,t.tokens+Math.floor(+b.amount));log(`🛠️ ${u.name} changed ${t.name}'s tokens by ${b.amount}`)}
  else if(a==='admvalue'){if(!I[b.item])E('Bad item');db.values[b.item]=Math.max(1,Math.floor(+b.value));log(`🛠️ ${u.name} set value of ${b.item} to ${b.value}`)}
  else if(a==='admcanceljp'){jpRefund();log(`🛠️ ${u.name} cancelled the jackpot (refunded)`)}
  else if(a==='admcancelmines'){const t=findUser(b.user);if(t.mines){t.tokens+=t.mines.bet;t.mines=null}log(`🛠️ ${u.name} cancelled ${t.name}'s mines game`)}
  else if(a==='admwd'){const w=db.wd.find(x=>x.id===b.id&&x.status==='pending')||E('Not found');
   if(b.ok){w.status='approved'}else{w.status='rejected';add(db.users[w.uid].inv,w.item,w.qty)}log(`📤 ${u.name} ${w.status} withdrawal ${w.qty}x ${w.item} for ${w.name}`)}
  else if(a==='admwebhook'){db.webhook=String(b.url||'');log('🔔 Webhook updated')}
  else E('Unknown');return{ok:1}}
 E('Unknown action')}
function minesCash(u){const g=u.mines,pay=Math.floor(g.bet*mult(g.m,g.open.length));u.tokens+=pay;u.wagered+=g.bet;u.profit+=pay-g.bet;u.mines=null;
 log(`💣 ${u.name} cashed out mines for ${pay} (bet ${g.bet})`);return{cashed:pay,mines:g.mines,open:g.open}}

module.exports=async(req,res)=>{
 const a=req.query.a,b=(req.body&&typeof req.body==='object')?req.body:{},H={};
 const ck=Object.fromEntries((req.headers.cookie||'').split('; ').map(c=>c.split('='))),sid=ck.sid;let out;
 try{
  if(!URL_||!TOK)E('Database not configured (Upstash env vars missing)');
  if(a==='start')out=await start(b);
  else if(a==='check')out=await check(b,H);
  else if(a==='state'||a==='lb'){await load();out=(jp.end&&Date.now()>=jp.end)?await mutate(()=>handle(a,b,sid,H)):await handle(a,b,sid,H)}
  else out=await mutate(()=>handle(a,b,sid,H));
 }catch(e){out={error:e.message||'Error'}}
 await Promise.allSettled(hooks.splice(0));
 for(const k in H)res.setHeader(k,H[k]);
 res.setHeader('Cache-Control','no-store');res.status(200).json(out)};
  
