// Sync MM2 — Vercel port (Milestone 1). State lives in Upstash Redis; a Redis lock serialises every write.
const crypto=require('crypto');
const ADMINS=(process.env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
const URL_=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,TOK=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const R=async(...c)=>{const r=await fetch(URL_,{method:'POST',headers:{Authorization:'Bearer '+TOK},body:JSON.stringify(c)});const j=await r.json();if(j.error)throw Error('DB: '+j.error);return j.result};
const MM2_ITEMS=[
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
let ITEMS=MM2_ITEMS,I=Object.fromEntries(ITEMS.map(i=>[i.id,i]));
// ---- Game modes: MM2 (tokens) and PS99 (gems). Each mode is its own world in Redis; Roblox logins/sessions are shared. ----
let MODE='mm2',KEY='db',MINB=5,MAIN=null,PSTS=0;
const setMode=m=>{MODE=m==='ps99'?'ps99':'mm2';KEY=MODE==='ps99'?'dbps':'db';MINB=MODE==='ps99'?1000000:5;if(MODE==='mm2'){ITEMS=MM2_ITEMS;I=Object.fromEntries(ITEMS.map(i=>[i.id,i]))}};
const fm=n=>Math.floor(n).toLocaleString('en-US');
// PS99 items = every Titanic + Huge pet from BIG Games' official API, valued at RAP (gems), with their official thumbnails. Cached 1h.
const PSTTL=3600000;
async function psFetch(prev){
 const g=u=>fetch(u,{headers:{accept:'application/json'}}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()});
 const[col,rap]=await Promise.all([g('https://ps99.biggamesapi.io/api/collection/Pets'),g('https://ps99.biggamesapi.io/api/rap')]);
 const th={};for(const p of col.data||[]){const n=p.configName,t=p.configData&&p.configData.thumbnail;if(/^(Titanic|Huge) /.test(n)&&t)th[n]=String(t).replace(/\D/g,'')}
 const items=[],seen={};
 for(const r of rap.data||[]){const cd=r.configData||{},n=cd.id;
  if(!n||cd.pt||cd.sh||!th[n]||!(r.value>0)||(r.category&&r.category!=='Pet'))continue;
  let id=n.toLowerCase().replace(/[^a-z0-9]+/g,'')||'pet';if(seen[id])id+=(++seen[id]);else seen[id]=1;
  items.push([id,n,n.startsWith('Titanic')?'titanic':'huge',Math.round(r.value),th[n]])}
 if(items.length<20)throw Error('no pets returned');
 for(const o of(prev&&prev.items)||[])if(!items.some(x=>x[0]===o[0]))items.push(o); // keep pets that dropped out of RAP so nobody's inventory breaks
 return{t:Date.now(),items}}
function psSet(c){PSTS=c.t;ITEMS=c.items.map(([id,name,rarity,value,t])=>({id,name,type:'pet',rarity,value,icon:'https://ps99.biggamesapi.io/image/'+t}));I=Object.fromEntries(ITEMS.map(i=>[i.id,i]))}
async function psLoad(){
 const raw=await R('GET','psitems');let c=raw?JSON.parse(raw):null;
 if(!c||Date.now()-c.t>PSTTL){
  if(!c||await R('SET','psitems:lock','1','NX','PX',60000)==='OK'){
   try{c=await psFetch(c)}catch(e){if(!c)throw Error('PS99 values are loading, try again in a moment ('+e.message+')');c.t=Date.now()-PSTTL+300000}
   await R('SET','psitems',JSON.stringify(c))}}
 psSet(c)}
let db,jp;
const load=async()=>{const s=await R('GET',KEY);db={users:{},sessions:{},shop:{},wd:[],values:{},webhook:'',logs:[],jp:null,chat:[],cf:{open:[],recent:[],id:0},rain:{r:-1,ann:false,joined:{}},...(s?JSON.parse(s):{})};
 if(MODE==='ps99'){const mm=await R('GET','db');MAIN=mm?JSON.parse(mm):{users:{},sessions:{}};db.sessions=MAIN.sessions||{};await psLoad()}
 if(db.cb){for(const g of db.cb.open||[])for(const p of g.players)if(!p.bot&&db.users[p.id])db.users[p.id].tokens+=g.cost;delete db.cb} // case battles were removed: refund anything still open
 jp=db.jp||(db.jp={players:{},end:0,id:0,last:null})};
// Device fingerprint: a salted, one-way hash of the request IP, stored per user so admins can see
// which accounts share a device (likely alts/ban evasion). Never the raw IP, never sent anywhere else.
const DEVSALT=process.env.DEVICE_SALT||'syncmm2-default-salt-change-me';
const getIp=req=>String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
const hashDev=ip=>ip?crypto.createHash('sha256').update(DEVSALT+ip).digest('hex').slice(0,20):'';
function altGroups(){const by={};for(const u of Object.values(db.users)){if(!u.dev)continue;(by[u.dev]=by[u.dev]||[]).push(u.name)}
 return Object.values(by).filter(g=>g.length>1)}
const persist=()=>R('SET',KEY,JSON.stringify(MODE==='ps99'?{...db,sessions:undefined}:db));
const save=()=>{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function mutate(fn){const t=crypto.randomBytes(8).toString('hex');let ok=0;
 for(let i=0;i<60&&!ok;i++){if(await R('SET','lock',t,'NX','PX',9000)==='OK')ok=1;else await sleep(100)}
 if(!ok)throw Error('Server busy, try again');
 try{await load();if(jp.end&&Date.now()>=jp.end)jpResolve();rainTick();const out=await fn();await persist();return out}
 finally{if(await R('GET','lock')===t)await R('DEL','lock')}}
// ---- daily stats (UTC day) for the Home page ----
const dayKey=()=>new Date().toISOString().slice(0,10);
const rec=(u,bet,pay)=>{const d=dayKey(),s=db.day&&db.day.d===d?db.day:(db.day={d,w:{},p:{},n:0,names:{},best:null});
 s.w[u.id]=(s.w[u.id]||0)+bet;s.p[u.id]=(s.p[u.id]||0)+(pay-bet);s.n++;s.names[u.id]=[u.name,u.avatar];
 if(pay-bet>0&&(!s.best||pay-bet>s.best.amt))s.best={name:u.name,avatar:u.avatar,amt:pay-bet,bet}};
const dayPub=()=>{const s=db.day&&db.day.d===dayKey()?db.day:null;if(!s)return{n:0,wag:0,top:[],most:[],best:null};
 const f=l=>l.slice(0,5).map(([k,v])=>({name:s.names[k][0],avatar:s.names[k][1],v:Math.floor(v)}));
 return{n:s.n,wag:Math.floor(Object.values(s.w).reduce((a,b)=>a+b,0)),top:f(Object.entries(s.p).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1])),most:f(Object.entries(s.w).sort((a,b)=>b[1]-a[1])),best:s.best}};
const val=id=>db.values[id]??(I[id]?I[id].value:0);
const IV=()=>crypto.createHash('md5').update(MODE+PSTS+JSON.stringify(db.values)).digest('hex').slice(0,10);
const invVal=u=>Object.entries(u.inv).reduce((s,[k,q])=>s+val(k)*q,0);
const add=(o,k,q)=>{o[k]=(o[k]||0)+q;if(o[k]<=0)delete o[k]};
const log=m=>{db.logs.push([Date.now(),m]);db.logs=db.logs.slice(-100)};
// ---- Discord webhooks: one channel per category, each with its own embed. URLs live in Redis ('whcfg', set in Admin > Webhooks) or env WEBHOOK_<CHANNEL>. A channel with no URL is skipped, never rerouted. ----
const CH={logins:['🔐 Logins',0x5b8def],coinflip:['🪙 Coinflip',0xf5c542],jackpot:['🎰 Jackpot',0xb47cff],blackjack:['🃏 Blackjack',0x22c55e],mines:['💣 Mines',0xef4444],towers:['🗼 Towers',0x38bdf8],tips:['🎁 Tips',0xff7ab8],exchange:['🔄 Exchange',0x2dd4bf],withdrawals:['📤 Withdrawals',0xf59e0b],rain:['🌧️ Rain',0x60a5fa],admin:['🛠️ Admin',0x94a3b8]};
const WHRE=/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
let SITE='',HQ=[];
const md=s=>String(s??'').replace(/([\\*_`~|>\[\]])/g,'\\$1'),cut=(s,n)=>{s=String(s);return s.length>n?s.slice(0,n-1)+'…':s};
const cur=()=>MODE==='ps99'?'gems':'tokens',nm=k=>(I[k]||{name:k}).name;
const ulink=u=>`[${md(u.name)}](https://www.roblox.com/users/${u.id}/profile)`;
const itl=(items,tk)=>[tk?`${fm(tk)} ${cur()}`:'',...Object.entries(items||{}).map(([k,q])=>`${q}× ${nm(k)}`)].filter(Boolean).join('\n')||'—';
function hk(ch,e){if(!CH[ch])return;HQ.push([ch,{title:cut(e.title,256),description:cut(e.desc||'',3800),color:e.color??CH[ch][1],
 fields:(e.fields||[]).filter(f=>f&&f[1]!==''&&f[1]!=null).slice(0,25).map(([n,v,i])=>({name:cut(n,256),value:cut(v,1024),inline:!!i})),
 thumbnail:e.user&&e.user.avatar?{url:e.user.avatar}:undefined,footer:{text:`Sync ${MODE==='ps99'?'PS99':'MM2'} · ${CH[ch][0].replace(/^\S+\s/,'')}`},timestamp:new Date().toISOString()}])}
// Win/loss embed shared by the casino games
const HR=(ch,u,t,bet,pay,x=[])=>hk(ch,{title:`${t} · ${pay>bet?'Win':pay===bet?'Push':'Loss'}`,color:pay>bet?0x22c55e:pay===bet?0x94a3b8:0xef4444,user:u,desc:ulink(u),
 fields:[['Bet',fm(bet)+' '+cur(),1],['Payout',fm(pay)+' '+cur(),1],['Profit',(pay>=bet?'+':'−')+fm(Math.abs(pay-bet))+' '+cur(),1],...x]});
const whCfg=async()=>{try{const r=await R('GET','whcfg');return r?JSON.parse(r):{}}catch{return{}}};
const whUrl=(c,k)=>c[k]||process.env['WEBHOOK_'+k.toUpperCase()]||'';
const whView=c=>Object.fromEntries(Object.entries(CH).map(([k,[n]])=>[k,{n,set:!!whUrl(c,k),src:c[k]?'site':whUrl(c,k)?'env':''}]));
const whPost=async(url,body,t=1)=>{try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3500)});
 if(r.status===429&&t){const j=await r.json().catch(()=>({}));await sleep(Math.min(2000,(j.retry_after||1)*1000));return whPost(url,body,0)}return r.ok}catch{return false}};
const whBody=(c,embeds)=>({username:'Sync · '+CH[c][0].replace(/^\S+\s/,''),avatar_url:SITE?SITE+'/logo.png':undefined,allowed_mentions:{parse:[]},embeds});
async function flushHooks(){const q=HQ.splice(0);if(!q.length)return;const cfg=await whCfg(),by={};for(const[c,e]of q)(by[c]=by[c]||[]).push(e);
 await Promise.allSettled(Object.entries(by).map(async([c,es])=>{const url=whUrl(cfg,c);if(!url||!WHRE.test(url))return;for(let i=0;i<es.length;i+=10)await whPost(url,whBody(c,es.slice(i,i+10)))}))}
const flag=c=>/^[A-Z]{2}$/.test(c||'')?String.fromCodePoint(...[...c].map(x=>127397+x.charCodeAt(0)))+' ':'';
const E=m=>{throw Error(m)};
const dd=x=>{try{return decodeURIComponent(x||'')}catch{return x||''}};
const geoOf=req=>{const h=req.headers,c=dd(h['x-vercel-ip-country']),r=dd(h['x-vercel-ip-country-region']),t=dd(h['x-vercel-ip-city']);return[t,r,c].filter(Boolean).join(', ')||'unknown location'};

const rj=async(u,o)=>{const r=await fetch(u,o);if(!r.ok)E('Roblox API error, try again');return r.json()};
const WORDS='apple tiger moon river frost ember cloud maple storm pearl cobra delta falcon jade lotus nova onyx pixel quartz raven solar tulip vivid zebra'.split(' ');
const needInt=(n,min=1)=>{n=Math.floor(+n);if(!(n>=min))E('Invalid amount');return n};
const findUser=s=>db.users[s]||Object.values(db.users).find(u=>u.name.toLowerCase()===String(s).toLowerCase())||E('User not found');

// ---- Sync Rain: every hour (GMT+6 hours align with UTC hours) the window opens at :55 and pays out at :00 ----
const RH=3600000,ROPEN=55*60000,RPOOL=100;
const chatSys=m=>{db.chat=db.chat||[];db.chat.push({id:crypto.randomBytes(4).toString('hex'),uid:'sys',name:'🌧️ Sync Rain',avatar:'',msg:m,t:Date.now(),sys:1});db.chat=db.chat.slice(-50)};
const rainNeeds=()=>{if(MODE!=='mm2')return false;const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);return(rd.ann&&n>=(rd.r+1)*RH)||(n%RH>=ROPEN&&rd.r!==cur)};
function rainPay(){const rd=db.rain,ids=Object.keys(rd.joined).filter(id=>db.users[id]),n=ids.length;rd.ann=false;rd.joined={};
 if(!n){chatSys('🌧️ Sync Rain ended — nobody joined.');return}
 let per=Math.floor(RPOOL/n),w=ids;
 if(per<1){per=1;for(let i=w.length-1;i>0;i--){const j=crypto.randomInt(i+1);[w[i],w[j]]=[w[j],w[i]]}w=w.slice(0,RPOOL)}
 w.forEach(id=>{db.users[id].tokens+=per});
 chatSys(`🌧️ Sync Rain distributed between ${n} each get ${per}`+(w.length<n?` (${w.length} lucky winners)`:''));log(`🌧️ Sync Rain: ${n} joined, ${per} each`);hk('rain',{title:'Sync Rain paid out',desc:`**${n}** player${n===1?'':'s'} joined`,fields:[['Each got',per+' tokens',1],['Winners',w.length+(w.length<n?' (lucky draw)':''),1],['Pool',RPOOL+' tokens',1]]})}
function rainTick(){if(MODE!=='mm2')return;const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);
 if(rd.ann&&n>=(rd.r+1)*RH)rainPay();
 if(n%RH>=ROPEN&&rd.r!==cur){rd.r=cur;rd.ann=true;rd.joined={};chatSys('Sync Rain started! 5 minutes to join— send a message in the site chat in this hour to be able to join.')}}
const rainQ=()=>{const t=crypto.randomInt(3);let a,b,ans,q;
 if(t===0){a=1+crypto.randomInt(20);b=1+crypto.randomInt(20);ans=a+b;q=`${a} + ${b}`}
 else if(t===1){a=5+crypto.randomInt(16);b=1+crypto.randomInt(a-1);ans=a-b;q=`${a} − ${b}`}
 else{a=2+crypto.randomInt(8);b=2+crypto.randomInt(8);ans=a*b;q=`${a} × ${b}`}return{q,ans}};
// ---- Blackjack (server-side deck; dealer hole card is never sent until the hand ends) ----
const BJR=['A','2','3','4','5','6','7','8','9','10','J','Q','K'],BJS=['♠','♥','♦','♣'];
const bjDeck=()=>{const d=[];for(const s of BJS)for(const r of BJR)d.push(r+s);for(let i=d.length-1;i>0;i--){const j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]]}return d};
const bjTot=h=>{let t=0,a=0;for(const c of h){const r=c.slice(0,-1);if(r==='A'){a++;t+=11}else t+=('JQK'.includes(r)||r==='10')?10:+r}while(t>21&&a){t-=10;a--}return t};
const bjView=g=>({id:g.id,bet:g.bet,player:g.p,dealer:g.done?g.d:[g.d[0],null],pv:bjTot(g.p),dv:g.done?bjTot(g.d):bjTot([g.d[0]]),done:g.done,result:g.result||null,payout:g.payout||0,doubled:!!g.dbl,canDouble:!g.done&&g.p.length===2&&!g.dbl});
function bjEnd(u,g,res){g.done=true;g.result=res;g.payout=res==='bj'?Math.floor(g.bet*2.5):res==='win'?g.bet*2:res==='push'?g.bet:0;
 u.tokens+=g.payout;u.wagered+=g.bet;u.profit+=g.payout-g.bet;rec(u,g.bet,g.payout);log(`🃏 ${u.name} blackjack ${res} (bet ${g.bet}, paid ${g.payout})`);HR('blackjack',u,'Blackjack',g.bet,g.payout,[['Result',res,1],['Hands',`You ${bjTot(g.p)} · Dealer ${bjTot(g.d)}`,1]])}
function bjDealer(u,g){while(bjTot(g.d)<17)g.d.push(g.k.pop());const p=bjTot(g.p),d=bjTot(g.d);bjEnd(u,g,d>21||p>d?'win':p===d?'push':'lose')}
// ---- Coinflip (item vs item, resolved instantly when someone joins) ----
const cfClean=items=>{const o={};for(const[k,q]of Object.entries(items||{})){if(!I[k])E('Bad item');o[k]=needInt(q)}return o};
const cfTok=t=>Math.max(0,Math.floor(+t||0));
// Resolve a coinflip: J = {user|null (null = SyncBot), items, tokens, value}. 3 coins, best of 3. 10% tax (tokens first, then cheapest items) -> shop.
function cfResolve(g,J){const cu=db.users[g.c.id],bot=!J.user,jSide=g.side==='heads'?'tails':'heads';
 const flips=[0,1,2].map(()=>crypto.randomInt(2)?'heads':'tails'),res=flips.filter(x=>x==='heads').length>=2?'heads':'tails',winC=res===g.side;
 const total=g.value+J.value,pot={};for(const it of[g.items,J.items])for(const[k,q]of Object.entries(it))add(pot,k,q);
 let ptok=(g.tokens||0)+J.tokens;const cap=total*.1;let tx=Math.min(Math.floor(cap),ptok);ptok-=tx;
 const units=[];Object.entries(pot).forEach(([k,q])=>{for(let i=0;i<q;i++)units.push(k)});units.sort((x,y)=>val(x)-val(y));
 for(const k of units){if(tx+val(k)<=cap){tx+=val(k);add(pot,k,-1);add(db.shop,k,1)}else break}
 const wu=winC?cu:J.user;
 if(wu){Object.entries(pot).forEach(([k,q])=>add(wu.inv,k,q));wu.tokens+=ptok}else Object.entries(pot).forEach(([k,q])=>add(db.shop,k,q));
 cu.wagered+=g.value;cu.profit+=(winC?total-tx:0)-g.value;rec(cu,g.value,winC?total-tx:0);if(J.user){J.user.wagered+=J.value;J.user.profit+=(winC?0:total-tx)-J.value;rec(J.user,J.value,winC?0:total-tx)}
 const jn=bot?{id:'bot',name:'SyncBot',avatar:'/logo.png',bot:1}:{id:J.user.id,name:J.user.name,avatar:J.user.avatar},w=winC?{id:g.c.id,name:g.c.name,avatar:g.c.avatar}:jn;
 db.cf.open=db.cf.open.filter(x=>x!==g);
 db.cf.recent.push({rid:db.cf.rid=(db.cf.rid||0)+1,id:g.id,c:g.c,j:jn,cSide:g.side,jSide,result:res,flips,winner:w,cItems:g.items,jItems:J.items,cTokens:g.tokens||0,jTokens:J.tokens,cValue:g.value,jValue:J.value,taxed:tx,won:total-tx,t:Date.now()});
 db.cf.recent=db.cf.recent.slice(-20);
 log(`🪙 Coinflip #${g.id}: ${w.name} won ${total-tx} value (${g.c.name} vs ${jn.name}, ${flips.join('/')})`);
 hk('coinflip',{title:`Coinflip #${g.id} · ${w.name} won`,color:0x22c55e,user:w,desc:`${md(g.c.name)} (${g.side}) vs ${md(jn.name)}${bot?' 🤖':''} (${jSide})\nFlips: ${flips.join(' · ')} → **${res}**`,fields:[['Pot',fm(total)+' '+cur(),1],['Tax',fm(tx)+' '+cur(),1],['Winner gets',fm(total-tx)+' '+cur(),1],[md(g.c.name)+' put in',itl(g.items,g.tokens),1],[md(jn.name)+' put in',J.user?itl(J.items,J.tokens):'Matched by SyncBot',1]]})}
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
 P.forEach(([id,p])=>{const u=db.users[id];u.wagered+=p.value;u.profit+=(id===w[0]?got:0)-p.value;rec(u,p.value,id===w[0]?got:0)});
 jp.last={rid:++jp.id,t:Date.now(),winner:w[0],name:w[1].name,total,taxed:s,snap:P.map(([id,p])=>({id,name:p.name,value:p.value}))};
 jp.players={};jp.end=0;log(`🎰 Jackpot #${jp.id}: ${w[1].name} won ${got} value (pot ${total}, tax ${s})`);
 hk('jackpot',{title:`Jackpot #${jp.id} · ${w[1].name} won`,color:0x22c55e,user:{avatar:w[1].avatar},desc:`${ulink({id:w[0],name:w[1].name})} took the pot`,fields:[['Pot',fm(total)+' '+cur(),1],['Tax',fm(s)+' '+cur(),1],['Winner gets',fm(got)+' '+cur(),1],['Players',P.map(([,p])=>`${md(p.name)} — ${fm(p.value)} (${(p.value/total*100).toFixed(1)}%)`).join('\n')]]})}
const mult=(m,n)=>{let x=.97;for(let k=0;k<n;k++)x*=(25-k)/(25-m-k);return x};

// ---- Towers (PS99 only): climb 8 floors, one safe tile per floor. Bomb layout is hidden server-side until the game ends. ----
const TWD={easy:[4,1],medium:[3,1],hard:[2,1],expert:[3,2]},TWR=8; // [tiles per floor, bombs per floor]
const twMult=(d,n)=>.97*Math.pow(TWD[d][0]/(TWD[d][0]-TWD[d][1]),n);
function twCash(u){const g=u.tw,pay=Math.floor(g.bet*twMult(g.d,g.picks.length));u.tokens+=pay;u.wagered+=g.bet;u.profit+=pay-g.bet;rec(u,g.bet,pay);u.tw=null;HR('towers',u,'Towers',g.bet,pay,[['Difficulty',g.d,1],['Floors',g.picks.length+' / '+TWR,1],['Multiplier',twMult(g.d,g.picks.length).toFixed(2)+'x',1]]);
 log(`🗼 ${u.name} cashed out towers for ${pay} (bet ${g.bet}, ${g.picks.length} floors, ${g.d})`);return{cashed:pay,bombs:g.bombs,picks:g.picks,d:g.d}}

async function start(b){
 const d=await rj('https://users.roblox.com/v1/usernames/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({usernames:[String(b.username||'').trim()],excludeBannedUsers:true})});
 const p=d.data[0];if(!p)E('Roblox user not found');
 const w=()=>WORDS[crypto.randomInt(WORDS.length)],tok=crypto.randomBytes(16).toString('hex'),code=`Sync ${b.gm==='ps99'?'PS99':'MM2'} - ${w()} ${w()} ${w()}`;
 await R('SET','p:'+tok,JSON.stringify({id:String(p.id),name:p.name,code}),'EX',600);
 return{tok,code,name:p.name,exp:Date.now()+600000}}
async function check(b,H,req){
 const raw=await R('GET','p:'+b.tok);if(!raw)E('Code expired — start again');const p=JSON.parse(raw);
 const d=await rj(`https://users.roblox.com/v1/users/${p.id}`);if(!(d.description||'').includes(p.code))return{waiting:true};
 let av='';try{av=(await rj(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${p.id}&size=150x150&format=Png`)).data[0].imageUrl}catch{}
 const dev=hashDev(getIp(req));
 return mutate(async()=>{const isNew=!db.users[p.id];const same=Object.values(db.users).filter(x=>dev&&x.id!==p.id&&x.dev===dev).map(x=>x.name);const u=db.users[p.id]||(db.users[p.id]={id:p.id,name:p.name,avatar:'',tokens:0,inv:{},wagered:0,profit:0,mines:null});
  u.name=p.name;u.avatar=av;if(dev)u.dev=dev;u.lastSeen=Date.now();const s=crypto.randomBytes(24).toString('hex');db.sessions[s]=p.id;await R('DEL','p:'+b.tok);
  H['Set-Cookie']=`sid=${s}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`;log(`✅ ${p.name} logged in`);hk('logins',{title:isNew?'New account':'Login',color:same.length?0xef4444:isNew?0x22c55e:undefined,user:{avatar:av},desc:`${ulink(p)} signed in`,fields:[['Roblox ID',p.id,1],['Location',flag(dd(req.headers['x-vercel-ip-country']))+geoOf(req),1],['IP address','`'+(getIp(req)||'unknown')+'`',1],['Device ID',dev?'`'+dev.slice(0,10)+'`':'',1],['⚠️ Shares a device with',same.map(md).join(', ')],['Browser',cut(req.headers['user-agent']||'',180)]]});return{ok:true}})}

async function handle(a,b,sid,H){
 if(a==='lb'){const us=Object.values(db.users),f=k=>us.slice().sort((x,y)=>y[k]-x[k]).slice(0,20).map(u=>({name:u.name,avatar:u.avatar,v:Math.floor(u[k])}));
  return{wagered:f('wagered'),profit:f('profit')}}
 const uid0=db.sessions[sid];let u=db.users[uid0];
 if(MODE==='ps99'&&uid0&&MAIN.users[uid0]){const mu=MAIN.users[uid0];
  u=db.users[uid0]||(db.users[uid0]={id:uid0,name:mu.name,avatar:mu.avatar,tokens:0,inv:{},wagered:0,profit:0,mines:null,lastSeen:Date.now()});
  u.name=mu.name;u.avatar=mu.avatar;if(mu.dev)u.dev=mu.dev}
 if(a==='state'){
  if(!u)return{guest:true};const admin=ADMINS.includes(u.id),m=u.mines,now=Date.now(),WC=admin?await whCfg():{};
  const online=Object.values(db.users).filter(x=>now-(x.lastSeen||0)<45000).map(x=>({id:x.id,name:x.name,avatar:x.avatar}));
  const activeMines=Object.values(db.users).filter(x=>x.mines).map(x=>({name:x.name,avatar:x.avatar,bet:x.mines.bet,m:x.mines.m,open:x.mines.open.length}));
  return{me:{id:u.id,name:u.name,avatar:u.avatar,tokens:u.tokens,inv:u.inv,invValue:invVal(u),admin},
   day:dayPub(),mode:MODE,minb:MINB,iv:IV(),items:(b.iv===IV())?null:ITEMS.map(i=>({...i,value:val(i.id)})),shop:db.shop,jp:jpPub(),cf:{open:db.cf.open,recent:db.cf.recent.slice(-10),now:Date.now()},
   bj:u.bj?bjView(u.bj):null,
   rain:MODE!=='mm2'?{off:true}:(()=>{const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH),on=!!rd.ann&&rd.r===cur&&n%RH>=ROPEN;return{now:n,pool:RPOOL,open:on,joined:on?Object.keys(rd.joined).length:0,me:{in:on&&!!rd.joined[u.id],chat:(u.lastChat||0)>=cur*RH}}})(),
   mines:m&&{bet:m.bet,m:m.m,open:m.open,mult:mult(m.m,m.open.length)},
   tw:u.tw?{bet:u.tw.bet,d:u.tw.d,picks:u.tw.picks,mult:twMult(u.tw.d,u.tw.picks.length)}:null,
   wd:db.wd.filter(w=>w.uid===u.id).slice(-10),tips:(db.tips||[]).filter(x=>x.from.id===u.id||x.to.id===u.id).slice(-15),
   online,activeMines,chat:(db.chat||[]).slice(-50),
   admin:admin?{wd:db.wd.filter(w=>w.status==='pending'),wh:whView(WC),logs:db.logs.slice(-15),alts:altGroups()}:undefined}}
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
 if(a==='sell'){const n=needInt(b.qty),v=take({[b.item]:n}),t=Math.floor(v*.9);u.tokens+=t;add(db.shop,b.item,n);log(`💱 ${u.name} sold ${n}x ${b.item} for ${t} tokens`);hk('exchange',{title:'Sold to shop',user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(b.item)}`,1],['Received',fm(t)+' '+cur(),1]]});return{ok:1}}
 if(a==='buy'){const n=needInt(b.qty);if(!I[b.item]||(db.shop[b.item]||0)<n)E('Out of stock');const p=Math.ceil(val(b.item)*1.1)*n;
  if(u.tokens<p)E('Not enough tokens');u.tokens-=p;add(db.shop,b.item,-n);add(u.inv,b.item,n);log(`🛒 ${u.name} bought ${n}x ${b.item} for ${p}`);hk('exchange',{title:'Bought from shop',color:0x2dd4bf,user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(b.item)}`,1],['Paid',fm(p)+' '+cur(),1]]});return{ok:1}}
 if(a==='jpjoin'){if(!b.items||!Object.keys(b.items).length)E('Select items');
  const v=take(b.items);if(MODE==='ps99'&&v<MINB)E('Minimum jackpot entry is '+fm(MINB));const p=jp.players[u.id]||(jp.players[u.id]={name:u.name,avatar:u.avatar,items:{},value:0});
  for(const[k,q]of Object.entries(b.items))add(p.items,k,q);p.value+=v;
  if(Object.keys(jp.players).length>=2&&!jp.end)jp.end=Date.now()+25000;return{ok:1}}
 if(a==='jpleave'){const p=jp.players[u.id];if(!p||Object.keys(jp.players).length>1)E('Cannot leave now');for(const[k,q]of Object.entries(p.items))add(u.inv,k,q);delete jp.players[u.id];return{ok:1}}
 if((a==='rainq'||a==='rainjoin')&&MODE!=='mm2')E('Sync Rain is MM2 only');
 if(a==='rainq'){const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);if(!(rd.ann&&rd.r===cur&&n%RH>=ROPEN))E('The rain is not open');if(rd.joined[u.id])E('Already joined');
  if((u.lastChat||0)<cur*RH)E('Send a message in the site chat this hour first');const x=rainQ();u.rq={ans:x.ans,exp:n+60000};return{q:x.q}}
 if(a==='rainjoin'){const n=Date.now(),rd=db.rain,cur=Math.floor(n/RH);if(!(rd.ann&&rd.r===cur&&n%RH>=ROPEN))E('The rain is not open');if(rd.joined[u.id])E('Already joined');
  if((u.lastChat||0)<cur*RH)E('Send a message in the site chat this hour first');const q=u.rq;delete u.rq;if(!q||n>q.exp)E('Question expired, get a new one');
  if(String(b.ans).trim()===''||Math.round(+b.ans)!==q.ans)E('Wrong answer');rd.joined[u.id]=1;return{ok:1}}
 if(a==='bjstart'){if(u.bj&&!u.bj.done)E('Finish your current hand first');const bet=needInt(b.bet);if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+(MODE==='ps99'?'gems':'tokens'));
  u.tokens-=bet;const k=bjDeck(),p1=k.pop(),d1=k.pop(),p2=k.pop(),d2=k.pop(),g=u.bj={id:Date.now(),bet,k,p:[p1,p2],d:[d1,d2],done:false};
  const pb=bjTot(g.p)===21,db_=bjTot(g.d)===21;if(pb||db_)bjEnd(u,g,pb&&db_?'push':pb?'bj':'lose');return{ok:1}}
 if(a==='bjhit'||a==='bjstand'||a==='bjdouble'){const g=u.bj;if(!g||g.done)E('No active hand');
  if(a==='bjstand')bjDealer(u,g);
  else{if(a==='bjdouble'){if(g.p.length!==2||g.dbl)E('Cannot double now');if(u.tokens<g.bet)E('Not enough tokens to double');u.tokens-=g.bet;g.bet*=2;g.dbl=1}
   g.p.push(g.k.pop());const t=bjTot(g.p);if(t>21)bjEnd(u,g,'bust');else if(t===21||g.dbl)bjDealer(u,g)}
  return{ok:1}}
 if(a==='cfcreate'){const items=cfClean(b.items),tk=cfTok(b.tokens),side=b.side==='tails'?'tails':'heads';
  if(db.cf.open.filter(g=>g.c.id===u.id).length>=3)E('Max 3 open coinflips');if(u.tokens<tk)E('Not enough tokens');
  const iv=cfVal(items);if(iv+tk<MINB)E('Minimum offer is '+fm(MINB));take(items);u.tokens-=tk;
  db.cf.open.push({id:++db.cf.id,c:{id:u.id,name:u.name,avatar:u.avatar},side,items,tokens:tk,value:iv+tk,t:Date.now()});
  log(`🪙 ${u.name} created coinflip #${db.cf.id} (${iv+tk} value, ${side})`);hk('coinflip',{title:`Coinflip #${db.cf.id} posted`,color:0x94a3b8,user:u,desc:`${ulink(u)} picked **${side}**`,fields:[['Offer',itl(items,tk),1],['Value',fm(iv+tk)+' '+cur(),1],['Join range',cfRange(iv+tk).map(fm).join(' – '),1]]});return{ok:1,id:db.cf.id}}
 if(a==='cfcancel'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game not found');if(g.c.id!==u.id)E('Not your game');
  for(const[k,q]of Object.entries(g.items))add(u.inv,k,q);u.tokens+=g.tokens||0;db.cf.open=db.cf.open.filter(x=>x!==g);return{ok:1}}
 if(a==='cfjoin'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id===u.id)E('Cannot join your own game');
  const items=cfClean(b.items),tk=cfTok(b.tokens),jv=cfVal(items)+tk,[lo,hi]=cfRange(g.value);if(!jv)E('Select items or tokens');if(jv<lo||jv>hi)E(`Your offer must be worth ${lo}-${hi}`);
  if(u.tokens<tk)E('Not enough tokens');take(items);u.tokens-=tk;cfResolve(g,{user:u,items,tokens:tk,value:jv});return{ok:1,id:g.id}}
 if(a==='cfbot'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id!==u.id)E('Only the creator can call SyncBot');
  cfResolve(g,{user:null,items:{},tokens:g.value,value:g.value});return{ok:1,id:g.id}}
 if(a==='minesstart'){if(u.mines)E('Game in progress');const bet=needInt(b.bet),m=needInt(b.m);if(m<1||m>24)E('Pick 1-24 mines');if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+(MODE==='ps99'?'gems':'tokens'));
  u.tokens-=bet;const mines=[];while(mines.length<m){const x=crypto.randomInt(25);if(!mines.includes(x))mines.push(x)}
  u.mines={bet,m,mines,open:[]};return{ok:1}}
 if(a==='minespick'){const g=u.mines;if(!g)E('No game');const i=needInt(b.i,0);if(i>24||g.open.includes(i))E('Invalid tile');
  if(g.mines.includes(i)){u.wagered+=g.bet;u.profit-=g.bet;rec(u,g.bet,0);u.mines=null;HR('mines',u,'Mines',g.bet,0,[['Mines',g.m,1],['Gems found',g.open.length,1],['Result','Hit a mine',1]]);return{boom:true,mines:g.mines,open:g.open}}
  g.open.push(i);if(g.open.length===25-g.m)return minesCash(u);return{safe:true}}
 if(a==='minescash'){if(!u.mines||!u.mines.open.length)E('Pick a tile first');return minesCash(u)}
 if(a==='withdraw'){const n=needInt(b.qty);take({[b.item]:n},MODE==='ps99'?['pet']:['gun','knife']);db.wd.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,item:b.item,qty:n,status:'pending',t:Date.now()});
  log(`📤 Withdraw request: ${u.name} ${n}x ${b.item}`);hk('withdrawals',{title:'Withdrawal requested',user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(b.item)}`,1],['Value',fm(val(b.item)*n)+' '+cur(),1],['Roblox ID',u.id,1]]});return{ok:1}}


 if(a==='tip'){const k=String(b.to||'').trim();let t=db.users[k]||Object.values(db.users).find(x=>x.name.toLowerCase()===k.toLowerCase());
  if(!t&&MODE==='ps99'){const mu=MAIN.users[k]||Object.values(MAIN.users).find(x=>x.name.toLowerCase()===k.toLowerCase());if(mu)t=db.users[mu.id]={id:mu.id,name:mu.name,avatar:mu.avatar,tokens:0,inv:{},wagered:0,profit:0,mines:null,lastSeen:0}}
  if(!t)E('Player not found. They need to have logged in once.');if(t.id===u.id)E('You cannot tip yourself');
  const items=cfClean(b.items),tk=cfTok(b.tokens);if(!tk&&!Object.keys(items).length)E('Pick '+(MODE==='ps99'?'gems or pets':'tokens or items')+' to tip');if(u.tokens<tk)E('Not enough '+cur());
  const iv=take(items);u.tokens-=tk;t.tokens+=tk;for(const[x,q]of Object.entries(items))add(t.inv,x,q);
  (db.tips=db.tips||[]).push({id:crypto.randomBytes(4).toString('hex'),from:{id:u.id,name:u.name,avatar:u.avatar},to:{id:t.id,name:t.name,avatar:t.avatar},items,tokens:tk,value:iv+tk,t:Date.now()});db.tips=db.tips.slice(-200);
  log(`🎁 ${u.name} tipped ${t.name} (${iv+tk} value)`);
  hk('tips',{title:'Tip sent',user:t,color:u.dev&&u.dev===t.dev?0xef4444:undefined,desc:`${ulink(u)} → ${ulink(t)}`,fields:[['Gems / tokens',tk?fm(tk)+' '+cur():'',1],['Items',Object.keys(items).length?itl(items,0):'',1],['Total value',fm(iv+tk)+' '+cur(),1],['⚠️ Same device','These two accounts share a device — possible alt transfer.']]});
  return{ok:1}}
 if(MODE!=='ps99'&&a.startsWith('tw'))E('Towers is PS99 only');
 if(a==='twstart'){if(u.tw)E('Game in progress');const bet=needInt(b.bet),d=TWD[b.diff]?b.diff:'medium',[c,k]=TWD[d];if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough gems');
  u.tokens-=bet;const bombs=[];for(let r=0;r<TWR;r++){const row=[];while(row.length<k){const x=crypto.randomInt(c);if(!row.includes(x))row.push(x)}bombs.push(row)}
  u.tw={bet,d,bombs,picks:[]};return{ok:1}}
 if(a==='twpick'){const g=u.tw;if(!g)E('No game');const i=needInt(b.i,0);if(i>=TWD[g.d][0])E('Invalid tile');
  if(g.bombs[g.picks.length].includes(i)){u.wagered+=g.bet;u.profit-=g.bet;rec(u,g.bet,0);u.tw=null;HR('towers',u,'Towers',g.bet,0,[['Difficulty',g.d,1],['Floors',g.picks.length+' / '+TWR,1],['Result','Hit a bomb on floor '+(g.picks.length+1),1]]);log(`🗼 ${u.name} hit a bomb in towers (bet ${g.bet}, floor ${g.picks.length+1}, ${g.d})`);return{boom:true,bombs:g.bombs,picks:g.picks.concat(i),d:g.d}}
  g.picks.push(i);if(g.picks.length===TWR)return twCash(u);return{safe:true}}
 if(a==='twcash'){if(!u.tw||!u.tw.picks.length)E('Climb a floor first');return twCash(u)}
 if(a.startsWith('adm')){if(!ADMINS.includes(u.id))E('Not admin');
  const logA=m=>{log(m);if(a!=='admwhtest')hk('admin',{title:'Admin action',user:u,desc:`${ulink(u)}\n${m.replace(/^\S+\s/,'')}`})};
  if(a==='admgive'){const t=findUser(b.user);if(!I[b.item])E('Bad item');add(t.inv,b.item,needInt(b.qty));logA(`🛠️ ${u.name} gave ${b.qty}x ${b.item} to ${t.name}`)}
  else if(a==='admset'){const t=findUser(b.user);if(!I[b.item])E('Bad item');const q=Math.max(0,Math.floor(+b.qty));delete t.inv[b.item];if(q)t.inv[b.item]=q;logA(`🛠️ ${u.name} set ${t.name}'s ${b.item} to ${q}`)}
  else if(a==='admtokens'){const t=findUser(b.user);t.tokens=Math.max(0,t.tokens+Math.floor(+b.amount));logA(`🛠️ ${u.name} changed ${t.name}'s tokens by ${b.amount}`)}
  else if(a==='admvalue'){if(!I[b.item])E('Bad item');db.values[b.item]=Math.max(1,Math.floor(+b.value));logA(`🛠️ ${u.name} set value of ${b.item} to ${b.value}`)}
  else if(a==='admcanceltw'){const t=findUser(b.user);if(t.tw){t.tokens+=t.tw.bet;t.tw=null}logA(`🛠️ ${u.name} cancelled ${t.name}'s towers game`)}
  else if(a==='admcanceljp'){jpRefund();logA(`🛠️ ${u.name} cancelled the jackpot (refunded)`)}
  else if(a==='admcancelmines'){const t=findUser(b.user);if(t.mines){t.tokens+=t.mines.bet;t.mines=null}logA(`🛠️ ${u.name} cancelled ${t.name}'s mines game`)}
  else if(a==='admwd'){const w=db.wd.find(x=>x.id===b.id&&x.status==='pending')||E('Not found');
   if(b.ok){w.status='approved'}else{w.status='rejected';add(db.users[w.uid].inv,w.item,w.qty)}log(`📤 ${u.name} ${w.status} withdrawal ${w.qty}x ${w.item} for ${w.name}`);hk('withdrawals',{title:'Withdrawal '+w.status,color:w.status==='approved'?0x22c55e:0xef4444,desc:`${md(w.name)} · ${w.qty}× ${nm(w.item)}\nHandled by ${ulink(u)}`})}
  else if(a==='admwh'){if(!CH[b.ch])E('Unknown channel');const url=String(b.url||'').trim();if(url&&!WHRE.test(url))E('That is not a Discord webhook URL');
   const c=await whCfg();if(url)c[b.ch]=url;else delete c[b.ch];await R('SET','whcfg',JSON.stringify(c));logA(`🔔 ${CH[b.ch][0]} webhook ${url?'updated':'removed'}`)}
  else if(a==='admwhtest'){if(!CH[b.ch])E('Unknown channel');const url=whUrl(await whCfg(),b.ch);if(!url)E('No webhook set for this channel');
   if(!await whPost(url,whBody(b.ch,[{title:'Webhook test',description:'✅ This channel is connected. Events for **'+CH[b.ch][0]+'** will appear here.',color:CH[b.ch][1],footer:{text:'Test sent by '+u.name},timestamp:new Date().toISOString()}])))E('Discord rejected the webhook')}
  else E('Unknown');return{ok:1}}
 E('Unknown action')}
function minesCash(u){const g=u.mines,pay=Math.floor(g.bet*mult(g.m,g.open.length));u.tokens+=pay;u.wagered+=g.bet;u.profit+=pay-g.bet;rec(u,g.bet,pay);u.mines=null;
 log(`💣 ${u.name} cashed out mines for ${pay} (bet ${g.bet})`);HR('mines',u,'Mines',g.bet,pay,[['Mines',g.m,1],['Gems found',g.open.length,1],['Multiplier',mult(g.m,g.open.length).toFixed(2)+'x',1]]);return{cashed:pay,mines:g.mines,open:g.open}}

module.exports=async(req,res)=>{
 const a=req.query.a,b=(req.body&&typeof req.body==='object')?req.body:{},H={};HQ.length=0;{const h=req.headers['x-forwarded-host']||req.headers.host;SITE=h?'https://'+h:''}
 setMode(['start','check','logout'].includes(a)?'mm2':b.gm);
 const ck=Object.fromEntries((req.headers.cookie||'').split('; ').map(c=>c.split('='))),sid=ck.sid;let out;
 try{
  if(!URL_||!TOK)E('Database not configured (Upstash env vars missing)');
  if(a==='start')out=await start(b);
  else if(a==='check')out=await check(b,H,req);
  else if(a==='lb'){await load();out=(jp.end&&Date.now()>=jp.end)?await mutate(()=>handle(a,b,sid,H)):await handle(a,b,sid,H)}
  else if(a==='state'){await load();const uid=db.sessions[sid];
   const needResolve=(jp.end&&Date.now()>=jp.end)||rainNeeds(),known=MODE==='ps99'?MAIN.users[uid]:db.users[uid],needTouch=uid&&known&&(!db.users[uid]||Date.now()-(db.users[uid].lastSeen||0)>20000);
   out=(needResolve||needTouch)?await mutate(()=>{if(needTouch){const uu=db.users[db.sessions[sid]];if(uu)uu.lastSeen=Date.now()}return handle(a,b,sid,H)}):await handle(a,b,sid,H)}
  else out=await mutate(()=>handle(a,b,sid,H));
 }catch(e){out={error:e.message||'Error'};HQ.length=0}
 await flushHooks();
 for(const k in H)res.setHeader(k,H[k]);
 res.setHeader('Cache-Control','no-store');res.status(200).json(out)};
  
