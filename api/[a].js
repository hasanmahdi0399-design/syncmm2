// Sync MM2 — Vercel port (Milestone 1). State lives in Upstash Redis; a Redis lock serialises every write.
const crypto=require('crypto');
const ADMINS=(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
const URL_=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,TOK=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const R=async(...c)=>{const r=await fetch(URL_,{method:'POST',headers:{Authorization:'Bearer '+TOK},body:JSON.stringify(c)});const j=await r.json();if(j.error)throw Error('DB: '+j.error);return j.result};
const ITEMS=[
['nikscythe','Nik\'s Scythe','knife','ancient',150000,'☠️'],
['elderwood','Elderwood Scythe','knife','ancient',130,'🌿'],
['logchopper','Log Chopper','knife','ancient',135,'🪓'],
['hallowscythe','Hallowscythe','knife','ancient',115,'🎃'],
['icebreaker','Icebreaker','knife','ancient',120,'🧊'],
['batwing','Batwing','knife','ancient',65,'🦇'],
['icewing','Ice Wing','knife','ancient',40,'❄️'],
['chromacandleflame','Chroma Candleflame','knife','chroma',245,'🕯️'],
['chromalightbringer','Chroma Lightbringer','gun','chroma',155,'✨'],
['chromadarkbringer','Chroma Darkbringer','gun','chroma',155,'🌑'],
['chromaluger','Chroma Luger','gun','chroma',125,'🔫'],
['chromagemstone','Chroma Gemstone','knife','chroma',100,'💎'],
['chromaheat','Chroma Heat','gun','chroma',115,'🔥'],
['chromalaser','Chroma Laser','gun','chroma',120,'🔦'],
['chromafang','Chroma Fang','knife','chroma',80,'🦷'],
['chromatides','Chroma Tides','gun','chroma',75,'🌊'],
['chromashark','Chroma Shark','gun','chroma',90,'🦈'],
['chromadeathshard','Chroma Death Shard','knife','chroma',65,'💀'],
['chromaslasher','Chroma Slasher','knife','chroma',70,'🗡️'],
['seer','Chroma Seer','knife','chroma',55,'🔮'],
['chromaboneblade','Chroma Boneblade','knife','chroma',55,'🦴'],
['chromasaw','Chroma Saw','knife','chroma',50,'🪚'],
['chromagingerblade','Chroma Gingerblade','knife','chroma',55,'🍪'],
['chromatravelersgun','Chroma Traveler\'s Gun','gun','chroma',185000,'🌈'],
['chromaevergun','Chroma Evergun','gun','chroma',69000,'🌈'],
['chromaevergreen','Chroma Evergreen','gun','chroma',46000,'🌲'],
['travelersgun','Traveler\'s Gun','gun','godly',5350,'🧭'],
['evergun','Evergun','gun','godly',3450,'♾️'],
['constellation','Constellation','gun','godly',3000,'🌌'],
['evergreen','Evergreen','gun','godly',2575,'🌲'],
['raygun','Raygun','gun','godly',1875,'👽'],
['darkshot','Darkshot','gun','godly',1800,'🌑'],
['alienbeam','Alienbeam','gun','godly',1825,'🛸'],
['darksword','Darksword','knife','godly',1775,'⚔️'],
['turkey','Turkey','knife','godly',1812,'🦃'],
['vampiresgun','Vampire\'s Gun','gun','godly',1788,'🧛'],
['blossom','Blossom','knife','godly',1370,'🌸'],
['sakura','Sakura','knife','godly',1360,'🌸'],
['sunrise','Sunrise','knife','godly',1075,'🌅'],
['bauble','Bauble','gun','godly',675,'🎄'],
['snowcannon','Snowcannon','gun','godly',675,'⛄'],
['candleflame','Candleflame','knife','godly',130,'🕯️'],
['sugar','Sugar','gun','godly',180,'🍬'],
['candy','Candy','knife','godly',180,'🍭'],
['elderwoodrevolver','Elderwood Revolver','gun','godly',145,'🌿'],
['redluger','Red Luger','gun','godly',135,'🔫'],
['eternalcane','Eternal Cane','knife','godly',133,'🦯'],
['lugercane','Luger Cane','gun','godly',130,'🔫'],
['eternal4','Eternal IV','knife','godly',128,'♾️'],
['amerilaser','Amerilaser','gun','godly',100,'🇺🇸'],
['gingerluger','Ginger Luger','gun','godly',125,'🍪'],
['jinglegun','Jinglegun','gun','godly',125,'🔔'],
['greenluger','Green Luger','gun','godly',85,'🔫'],
['pixel','Pixel','gun','godly',120,'👾'],
['oldglory','Old Glory','gun','godly',110,'🗽'],
['blaster','Blaster','gun','godly',93,'🔫'],
['virtual','Virtual','gun','godly',85,'🕹️'],
['clockwork','Clockwork','gun','godly',93,'⚙️'],
['eternal3','Eternal III','knife','godly',90,'♾️'],
['xmas','Xmas','gun','godly',80,'🎄'],
['iceblaster','Iceblaster','gun','godly',90,'🧊'],
['eternal2','Eternal II','knife','godly',70,'♾️'],
['hallowsedge','Hallow\'s Edge','knife','godly',83,'🎃'],
['luger','Luger','gun','godly',80,'🔫'],
['minty','Minty','gun','godly',60,'🍬'],
['boneblade','Boneblade','knife','godly',70,'🦴'],
['hallowgun','Hallowgun','gun','godly',65,'🎃'],
['chill','Chill','gun','godly',50,'🧊'],
['tides','Tides','gun','godly',67,'🌊'],
['flames','Flames','gun','godly',65,'🔥'],
['handsaw','Handsaw','knife','godly',35,'🪚'],
['shark','Shark','gun','godly',63,'🦈'],
['heat','Heat','gun','godly',60,'🔥'],
['battleaxe2','Battle Axe II','knife','godly',58,'🪓'],
['eternal','Eternal','knife','godly',55,'♾️'],
['spider','Spider','knife','godly',50,'🕷️'],
['pumpking','Pumpking','knife','godly',53,'🎃'],
['laser','Laser','gun','godly',48,'🔦'],
['lightbringer','Lightbringer','gun','godly',45,'✨'],
['darkbringer','Darkbringer','gun','godly',45,'🌑'],
['slasher','Slasher','knife','godly',43,'🗡️'],
['fang','Fang','knife','godly',43,'🦷'],
['deathshard','Death Shard','knife','godly',40,'💀'],
['nightblade','Night Blade','knife','godly',40,'🌙'],
['battleaxe','Battle Axe','knife','godly',38,'🪓'],
['gingerblade','Gingerblade','knife','godly',38,'🍪'],
['nebula','Nebula','knife','godly',38,'🌌'],
['winteredge','Winter\'s Edge','knife','godly',35,'❄️'],
['icedragon','Ice Dragon','knife','godly',35,'🐉'],
['redseer','Red Seer','knife','godly',35,'🔮'],
['blueseer','Blue Seer','knife','godly',35,'🔮'],
['purpleseer','Purple Seer','knife','godly',35,'🔮'],
['orangeseer','Orange Seer','knife','godly',35,'🔮'],
['yellowseer','Yellow Seer','knife','godly',35,'🔮'],
['gemstone','Gemstone','knife','godly',35,'💎'],
['frostsaber','Frostsaber','knife','godly',32,'🧊'],
['snowflake','Snowflake','knife','godly',32,'❄️'],
['iceshard','Ice Shard','knife','godly',30,'🧊'],
['saw','Saw','knife','godly',25,'🪚'],
['hallowsblade','Hallow\'s Blade','knife','godly',25,'🎃'],
['vampire','Vampire\'s Edge','knife','godly',25,'🧛'],
['ghostblade','Ghost Blade','knife','godly',22,'👻'],
['frostbite','Frostbite','knife','godly',20,'🧊'],
['peppermint','Peppermint','knife','godly',13,'🍬'],
['cookieblade','Cookieblade','knife','godly',13,'🍪'],
['heartblade','Heartblade','knife','godly',13,'💖'],
['eggblade','Eggblade','knife','godly',11,'🥚'],
['prismatic','Prismatic','knife','godly',8,'🌈'],
['bioblade','Bioblade','knife','godly',6,'☣️'],
['icepiercer','Icepiercer','knife','godly',45,'🗡️'],
['gingerscope','Gingerscope','gun','godly',90,'🍬'],
['harvester','Harvester','knife','ancient',300,'⚔️'],
['corrupt','Corrupt','knife','unique',220,'💀'],
['pet1','Pet Cat','pet','pet',5,'🐱'],
['pet2','Pet Dragon','pet','pet',70,'🐲']
].map(([id,name,type,rarity,value,icon])=>({id,name,type,rarity,value,icon}));
const I=Object.fromEntries(ITEMS.map(i=>[i.id,i]));
let db,jp,hooks=[];
const load=async()=>{const s=await R('GET','db');db={users:{},sessions:{},shop:{},wd:[],values:{},webhook:'',logs:[],jp:null,chat:[],cf:{open:[],recent:[],id:0},rain:{r:-1,ann:false,joined:{}},...(s?JSON.parse(s):{})};
 jp=db.jp||(db.jp={players:{},end:0,id:0,last:null})};
// Device fingerprint: a salted, one-way hash of the request IP, stored per user so admins can see
// which accounts share a device (likely alts/ban evasion). Never the raw IP, never sent anywhere else.
const DEVSALT=process.env.DEVICE_SALT||'syncmm2-default-salt-change-me';
const getIp=req=>String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
const hashDev=ip=>ip?crypto.createHash('sha256').update(DEVSALT+ip).digest('hex').slice(0,20):'';
function altGroups(){const by={};for(const u of Object.values(db.users)){if(!u.dev)continue;(by[u.dev]=by[u.dev]||[]).push(u.name)}
 return Object.values(by).filter(g=>g.length>1)}
const persist=()=>R('SET','db',JSON.stringify(db));
const save=()=>{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function mutate(fn){const t=crypto.randomBytes(8).toString('hex');let ok=0;
 for(let i=0;i<60&&!ok;i++){if(await R('SET','lock',t,'NX','PX',9000)==='OK')ok=1;else await sleep(100)}
 if(!ok)throw Error('Server busy, try again');
 try{await load();if(jp.end&&Date.now()>=jp.end)jpResolve();rainTick();const out=await fn();await persist();return out}
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

// ---- Sync Rain: every hour (GMT+6 hours align with UTC hours) the window opens at :55 and pays out at :00 ----
const RH=3600000,ROPEN=55*60000,RPOOL=100;
const chatSys=m=>{db.chat=db.chat||[];db.chat.push({id:crypto.randomBytes(4).toString('hex'),uid:'sys',name:'🌧️ Sync Rain',avatar:'',msg:m,t:Date.now(),sys:1});db.chat=db.chat.slice(-50)};
const rainNeeds=()=>{const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);return(rd.ann&&n>=(rd.r+1)*RH)||(n%RH>=ROPEN&&rd.r!==cur)};
function rainPay(){const rd=db.rain,ids=Object.keys(rd.joined).filter(id=>db.users[id]),n=ids.length;rd.ann=false;rd.joined={};
 if(!n){chatSys('🌧️ Sync Rain ended — nobody joined.');return}
 let per=Math.floor(RPOOL/n),w=ids;
 if(per<1){per=1;for(let i=w.length-1;i>0;i--){const j=crypto.randomInt(i+1);[w[i],w[j]]=[w[j],w[i]]}w=w.slice(0,RPOOL)}
 w.forEach(id=>{db.users[id].tokens+=per});
 chatSys(`🌧️ Sync Rain distributed between ${n} each get ${per}`+(w.length<n?` (${w.length} lucky winners)`:''));log(`🌧️ Sync Rain: ${n} joined, ${per} each`)}
function rainTick(){const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);
 if(rd.ann&&n>=(rd.r+1)*RH)rainPay();
 if(n%RH>=ROPEN&&rd.r!==cur){rd.r=cur;rd.ann=true;rd.joined={};chatSys('Sync Rain started! 5 minutes to join— send a message in the site chat in this hour to be able to join.')}}
const rainQ=()=>{const t=crypto.randomInt(3);let a,b,ans,q;
 if(t===0){a=1+crypto.randomInt(20);b=1+crypto.randomInt(20);ans=a+b;q=`${a} + ${b}`}
 else if(t===1){a=5+crypto.randomInt(16);b=1+crypto.randomInt(a-1);ans=a-b;q=`${a} − ${b}`}
 else{a=2+crypto.randomInt(8);b=2+crypto.randomInt(8);ans=a*b;q=`${a} × ${b}`}return{q,ans}};
// ---- Coinflip (item vs item, resolved instantly when someone joins) ----
const cfClean=items=>{const o={};for(const[k,q]of Object.entries(items||{})){if(!I[k])E('Bad item');o[k]=needInt(q)}if(!Object.keys(o).length)E('Select items');return o};
const cfVal=items=>Object.entries(items).reduce((s,[k,q])=>s+val(k)*q,0);
const cfRange=v=>[Math.ceil(v*.9),Math.floor(v*1.1)];
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
async function check(b,H,req){
 const raw=await R('GET','p:'+b.tok);if(!raw)E('Code expired — start again');const p=JSON.parse(raw);
 const d=await rj(`https://users.roblox.com/v1/users/${p.id}`);if(!(d.description||'').includes(p.code))return{waiting:true};
 let av='';try{av=(await rj(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${p.id}&size=150x150&format=Png`)).data[0].imageUrl}catch{}
 const dev=hashDev(getIp(req));
 return mutate(async()=>{const u=db.users[p.id]||(db.users[p.id]={id:p.id,name:p.name,avatar:'',tokens:0,inv:{},wagered:0,profit:0,mines:null});
  u.name=p.name;u.avatar=av;if(dev)u.dev=dev;u.lastSeen=Date.now();const s=crypto.randomBytes(24).toString('hex');db.sessions[s]=p.id;await R('DEL','p:'+b.tok);
  H['Set-Cookie']=`sid=${s}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`;log(`✅ ${p.name} logged in`);return{ok:true}})}

async function handle(a,b,sid,H){
 if(a==='lb'){const us=Object.values(db.users),f=k=>us.slice().sort((x,y)=>y[k]-x[k]).slice(0,20).map(u=>({name:u.name,avatar:u.avatar,v:Math.floor(u[k])}));
  return{wagered:f('wagered'),profit:f('profit')}}
 const u=db.users[db.sessions[sid]];
 if(a==='state'){
  if(!u)return{guest:true};const admin=ADMINS.includes(u.id),m=u.mines,now=Date.now();
  const online=Object.values(db.users).filter(x=>now-(x.lastSeen||0)<45000).map(x=>({id:x.id,name:x.name,avatar:x.avatar}));
  const activeMines=Object.values(db.users).filter(x=>x.mines).map(x=>({name:x.name,avatar:x.avatar,bet:x.mines.bet,m:x.mines.m,open:x.mines.open.length}));
  return{me:{id:u.id,name:u.name,avatar:u.avatar,tokens:u.tokens,inv:u.inv,invValue:invVal(u),admin},
   items:ITEMS.map(i=>({...i,value:val(i.id)})),shop:db.shop,jp:jpPub(),cf:{open:db.cf.open,recent:db.cf.recent.slice(-10),now:Date.now()},
   rain:(()=>{const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH),on=!!rd.ann&&rd.r===cur&&n%RH>=ROPEN;return{now:n,pool:RPOOL,open:on,joined:on?Object.keys(rd.joined).length:0,me:{in:on&&!!rd.joined[u.id],chat:(u.lastChat||0)>=cur*RH}}})(),
   mines:m&&{bet:m.bet,m:m.m,open:m.open,mult:mult(m.m,m.open.length)},
   wd:db.wd.filter(w=>w.uid===u.id).slice(-10),
   online,activeMines,chat:(db.chat||[]).slice(-50),
   admin:admin?{wd:db.wd.filter(w=>w.status==='pending'),webhook:!!db.webhook,logs:db.logs.slice(-15),alts:altGroups()}:undefined}}
 if(!u)E('Please log in');
 if(a==='logout'){delete db.sessions[sid];return{ok:1}}
 if(a==='chatsend'){const msg=String(b.msg||'').trim().slice(0,300);if(!msg)E('Empty message');
  db.chat=db.chat||[];const last=db.chat[db.chat.length-1];
  if(last&&last.uid===u.id&&Date.now()-last.t<1500)E('Slow down');
  db.chat.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,avatar:u.avatar,msg,t:Date.now()});u.lastChat=Date.now();
  db.chat=db.chat.slice(-50);return{ok:1}}
 if(!db.cf)db.cf={open:[],recent:[],id:0};
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
 if(a==='rainq'){const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);if(!(rd.ann&&rd.r===cur&&n%RH>=ROPEN))E('The rain is not open');if(rd.joined[u.id])E('Already joined');
  if((u.lastChat||0)<cur*RH)E('Send a message in the site chat this hour first');const x=rainQ();u.rq={ans:x.ans,exp:n+60000};return{q:x.q}}
 if(a==='rainjoin'){const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);if(!(rd.ann&&rd.r===cur&&n%RH>=ROPEN))E('The rain is not open');if(rd.joined[u.id])E('Already joined');
  if((u.lastChat||0)<cur*RH)E('Send a message in the site chat this hour first');const q=u.rq;delete u.rq;if(!q||n>q.exp)E('Question expired, get a new one');
  if(String(b.ans).trim()===''||Math.round(+b.ans)!==q.ans)E('Wrong answer');rd.joined[u.id]=1;return{ok:1}}
 if(a==='cfcreate'){const items=cfClean(b.items),side=b.side==='tails'?'tails':'heads';
  if(db.cf.open.filter(g=>g.c.id===u.id).length>=3)E('Max 3 open coinflips');
  const v=take(items);db.cf.open.push({id:++db.cf.id,c:{id:u.id,name:u.name,avatar:u.avatar},side,items,value:v,t:Date.now()});
  log(`🪙 ${u.name} created coinflip #${db.cf.id} (${v} value, ${side})`);return{ok:1,id:db.cf.id}}
 if(a==='cfcancel'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game not found');if(g.c.id!==u.id)E('Not your game');
  for(const[k,q]of Object.entries(g.items))add(u.inv,k,q);db.cf.open=db.cf.open.filter(x=>x!==g);return{ok:1}}
 if(a==='cfjoin'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id===u.id)E('Cannot join your own game');
  const items=cfClean(b.items),jv=cfVal(items),[lo,hi]=cfRange(g.value);if(jv<lo||jv>hi)E(`Your offer must be worth ${lo}-${hi}`);
  take(items);const side=g.side==='heads'?'tails':'heads',flips=[0,1,2].map(()=>crypto.randomInt(2)?'heads':'tails'),res=flips.filter(x=>x==='heads').length>=2?'heads':'tails';// best of 3 coins
  
  const winC=res===g.side,w=winC?{id:g.c.id,name:g.c.name,avatar:g.c.avatar}:{id:u.id,name:u.name,avatar:u.avatar},wu=db.users[w.id];
  const total=g.value+jv,pot={};for(const it of[g.items,items])for(const[k,q]of Object.entries(it))add(pot,k,q);
  const units=[];Object.entries(pot).forEach(([k,q])=>{for(let i=0;i<q;i++)units.push(k)});units.sort((x,y)=>val(x)-val(y));
  let tx=0;const cap=total*.1;for(const k of units){if(tx+val(k)<=cap){tx+=val(k);add(pot,k,-1);add(db.shop,k,1)}else break}
  Object.entries(pot).forEach(([k,q])=>add(wu.inv,k,q));
  const cu=db.users[g.c.id];cu.wagered+=g.value;u.wagered+=jv;
  cu.profit+=(winC?total-tx:0)-g.value;u.profit+=(winC?0:total-tx)-jv;
  db.cf.open=db.cf.open.filter(x=>x!==g);
  db.cf.recent.push({id:g.id,c:g.c,j:{id:u.id,name:u.name,avatar:u.avatar},cSide:g.side,jSide:side,result:res,flips,winner:w,cItems:g.items,jItems:items,cValue:g.value,jValue:jv,taxed:tx,won:total-tx,t:Date.now()});
  db.cf.recent=db.cf.recent.slice(-20);
  log(`🪙 Coinflip #${g.id}: **${w.name}** won ${total-tx} value (${g.c.name} vs ${u.name}, ${flips.join('/')})`);return{ok:1,id:g.id}}
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
  else if(a==='check')out=await check(b,H,req);
  else if(a==='lb'){await load();out=(jp.end&&Date.now()>=jp.end)?await mutate(()=>handle(a,b,sid,H)):await handle(a,b,sid,H)}
  else if(a==='state'){await load();const uid=db.sessions[sid];
   const needResolve=(jp.end&&Date.now()>=jp.end)||rainNeeds(),needTouch=uid&&db.users[uid]&&Date.now()-(db.users[uid].lastSeen||0)>20000;
   out=(needResolve||needTouch)?await mutate(()=>{if(needTouch){const uu=db.users[db.sessions[sid]];if(uu)uu.lastSeen=Date.now()}return handle(a,b,sid,H)}):await handle(a,b,sid,H)}
  else out=await mutate(()=>handle(a,b,sid,H));
 }catch(e){out={error:e.message||'Error'}}
 await Promise.allSettled(hooks.splice(0));
 for(const k in H)res.setHeader(k,H[k]);
 res.setHeader('Cache-Control','no-store');res.status(200).json(out)};
  
