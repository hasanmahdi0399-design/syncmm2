// Sync MM2 — Vercel port (Milestone 1). State lives in Upstash Redis; a Redis lock serialises every write.
const crypto=require('crypto');
// ---- Roles ----
// OWNER: full control (logs, same-IP alt accounts, admin passwords, webhooks, login-as, data repair).
// ADMIN: items, shop, values, codes, leaderboards, withdrawals/deposits, player balances. Nothing else.
// Add owner Roblox IDs in Vercel > Settings > Environment Variables as OWNER_IDS (comma separated, e.g. 123,456),
// or paste them into OWNER_IDS_HARDCODED below. Owners are automatically admins. ADMIN_IDS = normal admins.
const OWNER_IDS_HARDCODED=[]; // e.g. ['1234567890']
const idList=v=>String(v||'').split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
const OWNERS=[...new Set([...idList(process.env.OWNER_IDS),...idList(process.env.OWNER_ID),...OWNER_IDS_HARDCODED.map(String)])];
const ADMIN_ENV=[...new Set([...idList(process.env.ADMIN_IDS),...OWNERS])];
const ADMINS=[...ADMIN_ENV]; // live list = env/owners + admins the Owner added in the panel (Redis 'admins'); refreshed each request by syncAdmins()
const isOwner=id=>OWNERS.includes(String(id));
// Actions only an Owner may run (everything else starting with "adm" is open to admins).
const OWNER_ONLY=new Set(['admaddadmin','admdeladmin','admstreamer','admstreamerdel','admpwset','admpwdel','admwh','admwhtest','admrepair','admlogin','admkick']);
// ---- IP bans: Redis key 'ipbans' (shared by MM2 and PS99) = {playerId:{uid,name,avatar,dev,reason,by,byName,t,adm}}.
// A ban blocks that account AND every non-staff account/visitor on the same IP. Owners can never be banned.
// Admins can only be banned/unbanned by an Owner. Staff are exempt from IP matching, so sharing an IP with a banned player never locks them out.
let BANC=null,BANT=0,CURDEV='';
const URL_=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,TOK=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
const R=async(...c)=>{const r=await fetch(URL_,{method:'POST',headers:{Authorization:'Bearer '+TOK},body:JSON.stringify(c)});const j=await r.json();if(j.error)throw Error('DB: '+j.error);return j.result};
const getBans=async()=>{if(BANC&&Date.now()-BANT<8000)return BANC;let m={};try{const r=await R('GET','ipbans');m=r?JSON.parse(r):{}}catch{}BANC=m;BANT=Date.now();return m};
const putBans=async m=>{await R('SET','ipbans',JSON.stringify(m));BANC=m;BANT=Date.now()};
const banHit=(bans,uid,dev)=>{uid=uid?String(uid):'';if(uid&&isOwner(uid))return null;return(uid&&bans[uid])||(dev&&!(uid&&ADMINS.includes(uid))&&Object.values(bans).find(x=>x.dev&&x.dev===dev))||null};
// ---- Streamers: Redis 'streamers' = {id:{id,name,t,by}} (+ STREAMER_IDS env, comma separated). Owner adds/removes them in the admin panel.
// Streamers get a Streamer page: currency-only codes (gems on PS99 / tokens on MM2, never items), claim limit required, only their own codes.
const STR_ENV=idList(process.env.STREAMER_IDS);let STRC=null,STRT=0;
const getStreamers=async()=>{if(!STRC||Date.now()-STRT>=8000){let m={};try{const r=await R('GET','streamers');m=r?JSON.parse(r):{}}catch{}STRC=m;STRT=Date.now()}const o={...STRC};for(const id of STR_ENV)o[id]={...(o[id]||{id,name:''}),env:true};return o};
const putStreamers=async m=>{const c={};for(const[k,v]of Object.entries(m))if(!v.env)c[k]=v;await R('SET','streamers',JSON.stringify(c));STRC=c;STRT=Date.now()};

// ---- Discord linking (OAuth2 'identify' scope, so the link is verified, never typed in). Needs env vars DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET,
// and this redirect URI added in the Discord developer portal (OAuth2 > Redirects): https://YOUR-SITE/api/dcback  (or set DISCORD_REDIRECT_URI to override).
// Redis hash 'dclinks' = {robloxId: JSON{id,name,user,avatar,t}}, hash 'dcby' = {discordId: robloxId} (one Discord account per player). Shared by MM2 and PS99.
const dcOn=()=>!!(process.env.DISCORD_CLIENT_ID&&process.env.DISCORD_CLIENT_SECRET);
const dcSecret=()=>process.env.DISCORD_CLIENT_SECRET||process.env.DEVICE_SALT||'syncmm2-default-salt-change-me';
const dcRedirect=()=>process.env.DISCORD_REDIRECT_URI||SITE+'/api/dcback';
const dcGet=async id=>{try{const r=await R('HGET','dclinks',String(id));return r?JSON.parse(r):null}catch{return null}};
const dcSign=p=>{const d=Buffer.from(JSON.stringify(p)).toString('base64url');return d+'.'+crypto.createHmac('sha256',dcSecret()).update(d).digest('base64url')};
const dcVerify=s=>{const[d,g]=String(s||'').split('.');if(!d||!g)return null;const e=crypto.createHmac('sha256',dcSecret()).update(d).digest('base64url');
 if(g.length!==e.length||!crypto.timingSafeEqual(Buffer.from(g),Buffer.from(e)))return null;try{const p=JSON.parse(Buffer.from(d,'base64url').toString());return p.e>Date.now()?p:null}catch{return null}};
const dcAvatar=u=>u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`:`https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id)>>22n)%6n)}.png`;
// ---- Wager lock (PS99): gems from redeemed codes must be wagered at 90% before ANY withdrawal. u.wl={base:wagered at redeem,req:total still required}.
// Remaining = req - (wagered - base). Stacks if the player redeems several codes. Counts every game via u.wagered, so no game code needs touching.
const WAGER_LOCK=0.9;
const wlAdd=(u,n)=>{u.wl={base:u.wagered||0,req:wlLeft(u)+Math.ceil(n*WAGER_LOCK)}}; // adds n to the lock at 90%, stacks with whatever is already locked
const wlLeft=u=>{const l=u&&u.wl;if(!l)return 0;return Math.max(0,Math.ceil(l.req-Math.max(0,(u.wagered||0)-l.base)))};
// Chat/profile tag: owner > admin > streamer
const roleOf=(id,STR)=>isOwner(id)?'owner':ADMINS.includes(String(id))?'admin':(STR&&STR[id])?'streamer':'';
// GET /api/dcback?code=..&state=.. — Discord sends the player back here after they approve.
const dcBack=async(req,res,sid)=>{
 const back=(ok,m)=>{res.setHeader('Cache-Control','no-store');res.statusCode=302;res.setHeader('Location','/settings?discord='+(ok?'ok':'err')+(m?'&m='+encodeURIComponent(m):''));res.end()};
 try{
  const q=req.query||{};
  if(q.error)return back(0,'Discord linking was cancelled');
  if(!dcOn())return back(0,'Discord linking is not set up yet');
  const st=dcVerify(q.state);if(!st||!q.code)return back(0,'Link expired, please try again');
  setMode('mm2');await load();
  if(!sid||String(db.sessions[sid])!==String(st.u))return back(0,'Please log in first, then try again');
  const tr=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:String(q.code),redirect_uri:dcRedirect()})});
  const tj=await tr.json();if(!tj.access_token)return back(0,'Discord rejected the login, try again');
  const ur=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+tj.access_token}});const du=await ur.json();
  if(!du||!du.id)return back(0,'Could not read your Discord account');
  const owner=await R('HGET','dcby',du.id);if(owner&&String(owner)!==String(st.u))return back(0,'That Discord account is already linked to another player');
  const old=await dcGet(st.u);if(old&&old.id!==du.id)await R('HDEL','dcby',old.id);
  const link={id:du.id,name:String(du.global_name||du.username).slice(0,40),user:String(du.username).slice(0,40),avatar:dcAvatar(du),t:Date.now()};
  await R('HSET','dclinks',String(st.u),JSON.stringify(link));await R('HSET','dcby',du.id,String(st.u));
  return back(1)
 }catch(e){return back(0,'Could not link Discord')}
};
let ADMC=null,ADMT=0;
const getAdminStore=async()=>{if(!ADMC||Date.now()-ADMT>=8000){let m={};try{const r=await R('GET','admins');m=r?JSON.parse(r):{}}catch{}ADMC=m;ADMT=Date.now()}return ADMC};
const putAdminStore=async m=>{await R('SET','admins',JSON.stringify(m));ADMC=m;ADMT=Date.now();await syncAdmins()};
const syncAdmins=async()=>{const m=await getAdminStore(),ids=[...new Set([...ADMIN_ENV,...Object.keys(m)])];ADMINS.length=0;ADMINS.push(...ids)};
const banMsg=b=>'You are banned from this site'+(b&&b.reason?' — '+b.reason:'');
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
// ---- MM2 legendaries: values copied from supremevalues.com/mm2/legendaries. Tier 3 is priced in tokens; Tier 2 / Tier 1 are priced in T1 items (shown via the vt label, same as pets). ----
['lattegun','Latte (Gun)','gun','legendary',140,'🔫'],
['latteknife','Latte (Knife)','knife','legendary',140,'🗡️'],
['spectralknife','Spectral (Knife)','knife','legendary',50,'🗡️'],
['travelergun','Traveler (Gun)','gun','legendary',50,'🔫'],
['auroragun','Aurora (Gun)','gun','legendary',45,'🔫'],
['vampiregun','Vampire (Gun)','gun','legendary',45,'🔫'],
['beach','Beach','knife','legendary',35,'🗡️'],
['cottoncandy','Cotton Candy','knife','legendary',35,'🗡️'],
['jd','JD','knife','legendary',28,'🗡️'],
['bunnies','Bunnies','knife','legendary',15,'🗡️'],
['arcticgun','Arctic (Gun)','gun','legendary',10,'🔫'],
['golden','Golden','knife','legendary',10,'🗡️'],
['shadow','Shadow','gun','legendary',10,'🔫'],
['cavernknife','Cavern (Knife)','knife','legendary',7,'🗡️'],
['broken','Broken','knife','legendary',7,'🗡️'],
['emberknife','Emberknife','knife','legendary',5,'🗡️'],
['icedriller','Icedriller','gun','legendary',5,'🔫'],
['nightsky','Nightsky','gun','legendary',5,'🔫'],
['ghostknife','Ghost (Knife)','knife','legendary',5,'🗡️'],
['gingergun','Ginger (Gun)','gun','legendary',5,'🔫'],
['redscratch','Red Scratch','knife','legendary',4,'🗡️'],
['skulls','Skulls','knife','legendary',4,'🗡️'],
['auroraknife','Aurora (Knife)','knife','legendary',3,'🗡️'],
['spectralgun','Spectral (Gun)','gun','legendary',3,'🔫'],
['travelerknife','Traveler (Knife)','knife','legendary',3,'🗡️'],
['vampireknife','Vampire (Knife)','knife','legendary',3,'🗡️'],
['witched','Witched','knife','legendary',3,'🗡️'],
['blueelite','Blue Elite','knife','legendary',3,'🗡️'],
['greenelite','Green Elite','knife','legendary',3,'🗡️'],
['santasmagic','Santa\'s Magic','knife','legendary',3,'🗡️'],
['santasspirit','Santa\'s Spirit','knife','legendary',3,'🗡️'],
['energizedgun','Energized (Gun)','gun','legendary',2,'🔫'],
['frostfadeknife','Frostfade (Knife)','knife','legendary',2,'🗡️'],
['bluescratch','Blue Scratch','knife','legendary',2,'🗡️'],
['ghostgun','Ghost (Gun)','gun','legendary',2,'🔫'],
['chromaticknife','Chromatic (Knife)','knife','legendary',1,'🗡️'],
['icecracker','Icecracker','knife','legendary',1,'🗡️'],
['redfire','Red Fire','knife','legendary',1,'🗡️'],
['caverngun','Cavern (Gun)','gun','legendary',1,'🔫'],
['arcticknife','Arctic (Knife)','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['chromaticgun','Chromatic (Gun)','gun','legendary',1,'🔫','x4 T1 Legendaries'],
['cursedknife','Cursed (Knife)','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['embergun','Embergun','gun','legendary',1,'🔫','x4 T1 Legendaries'],
['emerald','Emerald','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['energizedknife','Energized (Knife)','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['frozengun','Frozen (Gun)','gun','legendary',1,'🔫','x4 T1 Legendaries'],
['nightstar','Nightstar','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['overseergun','Overseer (Gun)','gun','legendary',1,'🔫','x4 T1 Legendaries'],
['predatorknife','Predator (Knife)','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['ripperknife','Ripper (Knife)','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['rupture','Rupture','gun','legendary',1,'🔫','x4 T1 Legendaries'],
['treegun','Tree (Gun)','gun','legendary',1,'🔫','x4 T1 Legendaries'],
['treeknife','Tree (Knife)','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['web','Web','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['greenfire','Green Fire','knife','legendary',1,'🗡️','x4 T1 Legendaries'],
['aquariumgun','Aquarium (Gun)','gun','legendary',1,'🔫','x3 T1 Legendaries'],
['cursedgun','Cursed (Gun)','gun','legendary',1,'🔫','x3 T1 Legendaries'],
['frostfadegun','Frostfade (Gun)','gun','legendary',1,'🔫','x3 T1 Legendaries'],
['frozenknife','Frozen (Knife)','knife','legendary',1,'🗡️','x3 T1 Legendaries'],
['midnight','Midnight','knife','legendary',1,'🗡️','x3 T1 Legendaries'],
['palmsgun','Palms (Gun)','gun','legendary',1,'🔫','x3 T1 Legendaries'],
['sparkle','Sparkle','gun','legendary',1,'🔫','x3 T1 Legendaries'],
['bubbles','Bubbles','knife','legendary',1,'🗡️','x2 T1 Legendaries'],
['cupid','Cupid','knife','legendary',1,'🗡️','x2 T1 Legendaries'],
['gingerknife','Ginger (Knife)','knife','legendary',1,'🗡️','x2 T1 Legendaries'],
['rippergun','Ripper (Gun)','gun','legendary',1,'🔫','x2 T1 Legendaries'],
['aquariumknife','Aquarium (Knife)','knife','legendary',1,'🗡️','x2 T1 Legendaries'],
['palmsknife','Palms (Knife)','knife','legendary',1,'🗡️','x2 T1 Legendaries'],
['overseerknife','Overseer (Knife)','knife','legendary',1,'🗡️','x4 T1 Rares'],
['predatorgun','Predator (Gun)','gun','legendary',1,'🔫','x4 T1 Rares'],
['rune','Rune','knife','legendary',1,'🗡️','x4 T1 Rares'],
['universe','Universe','gun','legendary',1,'🔫','x4 T1 Rares'],
['viper','Viper','gun','legendary',1,'🔫','x4 T1 Rares'],
['fade','Fade','knife','legendary',1,'🗡️','x4 T1 Rares'],
['fusion','Fusion','knife','legendary',1,'🗡️','x4 T1 Rares'],
['plasmite','Plasmite','knife','legendary',1,'🗡️','x4 T1 Rares'],
['shiny','Shiny','knife','legendary',1,'🗡️','x4 T1 Rares'],
['splashknife','Splash (Knife)','knife','legendary',1,'🗡️','x4 T1 Rares'],
['elite','Elite','knife','legendary',1,'🗡️','x3 T1 Rares'],
['splashgun','Splash (Gun)','gun','legendary',1,'🔫','x3 T1 Rares'],
// ---- MM2 pets: values copied from supremevalues.com/mm2/pets. Tier 1 pets are priced there in T1 items (e.g. 'x3 T1 Legendaries'), so they are worth 1 here and show that text.
['pet_zombiedog','Zombie Dog','pet','pet',750,'🐾'],
['pet_elf2019','Elf (2019)','pet','pet',625,'🐾'],
['pet_bluepumpkin220','Blue Pumpkin','pet','pet',220,'🐾'],
['pet_dogey','Dogey','pet','pet',150,'🐾'],
['pet_redpumpkin120','Red Pumpkin','pet','pet',120,'🐾'],
['pet_blackcat','Black Cat','pet','pet',75,'🐾'],
['pet_greenpumpkin60','Green Pumpkin','pet','pet',60,'🐾'],
['pet_piggy','Piggy','pet','pet',55,'🐾'],
['pet_mrreindeer','Mr. Reindeer','pet','pet',50,'🐾'],
['pet_pumpkin2017','Pumpkin (2017)','pet','pet',50,'🐾'],
['pet_elf','Elf','pet','pet',25,'🐾'],
['pet_redpumpkin20','Red Pumpkin','pet','pet',20,'🐾'],
['pet_mrsnowman','Mr. Snowman','pet','pet',20,'🐾'],
['pet_redpumpkin17','Red Pumpkin','pet','pet',17,'🐾'],
['pet_skully','Skully','pet','pet',15,'🐾'],
['pet_greenpumpkin12','Green Pumpkin','pet','pet',12,'🐾'],
['pet_greenpumpkin10','Green Pumpkin','pet','pet',10,'🐾'],
['pet_bluepumpkin7','Blue Pumpkin','pet','pet',7,'🐾'],
['pet_lt3','<3','pet','pet',7,'🐾'],
['pet_shadowpumpkin','Shadow Pumpkin','pet','pet',5,'🐾'],
['pet_nobledragon','Nobledragon','pet','pet',5,'🐾'],
['pet_snowbear','Snowbear','pet','pet',3,'🐾'],
['pet_chilly','Chilly','pet','pet',3,'🐾'],
['pet_eyeball','Eyeball','pet','pet',3,'🐾'],
['pet_fairy','Fairy','pet','pet',3,'🐾'],
['pet_greenpumpkin3','Green Pumpkin','pet','pet',3,'🐾'],
['pet_jetstream','Jetstream','pet','pet',3,'🐾'],
['pet_mechbug','Mechbug','pet','pet',3,'🐾'],
['pet_overseereye','Overseer Eye','pet','pet',3,'🐾'],
['pet_pengy','Pengy','pet','pet',3,'🐾'],
['pet_purplepumpkin','Purple Pumpkin','pet','pet',3,'🐾'],
['pet_redpumpkin3','Red Pumpkin','pet','pet',3,'🐾'],
['pet_reindeer','Reindeer','pet','pet',3,'🐾'],
['pet_rudolph','Rudolph','pet','pet',3,'🐾'],
['pet_seahorsey','Seahorsey','pet','pet',3,'🐾'],
['pet_tankie','Tankie','pet','pet',3,'🐾'],
['pet_ufo','UFO','pet','pet',3,'🐾'],
['pet_vampirebat','Vampire Bat','pet','pet',3,'🐾'],
['pet_lilalien','Lil\' Alien','pet','pet',1,'🐾'],
['pet_badger','Badger','pet','pet',1,'🐾'],
['pet_bluepumpkin1','Blue Pumpkin','pet','pet',1,'🐾'],
['pet_chromafirebat','Chroma Fire Bat','pet','pet',3,'🐾'],
['pet_chromafirebear','Chroma Fire Bear','pet','pet',3,'🐾'],
['pet_chromafirebunny','Chroma Fire Bunny','pet','pet',3,'🐾'],
['pet_chromafirecat','Chroma Fire Cat','pet','pet',3,'🐾'],
['pet_chromafiredog','Chroma Fire Dog','pet','pet',3,'🐾'],
['pet_chromafirefox','Chroma Fire Fox','pet','pet',3,'🐾'],
['pet_chromafirepig','Chroma Fire Pig','pet','pet',3,'🐾'],
['pet_carrotbunny','Carrot Bunny','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_deathspeaker','Deathspeaker','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_electro','Electro','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_frostbird','Frostbird','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_icephoenix','Ice Phoenix','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_icey','Icey','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_phoenix','Phoenix','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_sammy','Sammy','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_skelly','Skelly','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_steambird','Steambird','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_traveller','Traveller','pet','pet',1,'🐾','x3 T1 Legendaries'],
['pet_pumpkin2018','Pumpkin (2018)','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firebat','Fire Bat','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firebear','Fire Bear','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firebunny','Fire Bunny','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firecat','Fire Cat','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firedog','Fire Dog','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firefox','Fire Fox','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_firepig','Fire Pig','pet','pet',1,'🐾','x2 T1 Legendaries'],
['pet_scarecrow','Scarecrow','pet','pet',1,'🐾','x1 T1 Legendary'],
['pet_teddy','Teddy','pet','pet',1,'🐾','x1 T1 Legendary'],
['pet_pumpkin2019','Pumpkin (2019)','pet','pet',1,'🐾','x3 T1 Uncommons'],
['pet_bat','Bat','pet','pet',1,'🐾','x2 T1 Uncommons'],
['pet_santadog','Santa Dog','pet','pet',1,'🐾','x1 T1 Uncommon'],
['pet_elitey','Elitey','pet','pet',1,'🐾','x1 T1 Uncommon'],
['pet_bear','Bear','pet','pet',1,'🐾','x3 T1 Commons'],
['pet_fox','Fox','pet','pet',1,'🐾','x2 T1 Commons'],
['pet_pig','Pig','pet','pet',1,'🐾','x2 T1 Commons'],
['pet_pumpkin2020','Pumpkin (2020)','pet','pet',1,'🐾','x2 T1 Commons'],
['pet_cat','Cat','pet','pet',1,'🐾','x1 T1 Common'],
['pet_dog','Dog','pet','pet',1,'🐾','x1 T1 Common'],
['pet_pumpkin2021','Pumpkin (2021)','pet','pet',1,'🐾','x1 T1 Common'],
['pet1','Pet Cat','pet','pet',5,'🐱'],
['pet2','Pet Dragon','pet','pet',70,'🐲']
].map(([id,name,type,rarity,value,icon,vt])=>vt?{id,name,type,rarity,value,icon,vt}:{id,name,type,rarity,value,icon});
let ITEMS=MM2_ITEMS,I=Object.fromEntries(ITEMS.map(i=>[i.id,i]));
// ---- Game modes: MM2 (tokens) and PS99 (gems). Each mode is its own world in Redis; Roblox logins/sessions are shared. ----
let MODE='mm2',KEY='db',MINB=5,MAIN=null,PSTS=0;
const setMode=m=>{MODE=m==='ps99'?'ps99':'mm2';KEY=MODE==='ps99'?'dbps':'db';MINB=MODE==='ps99'?1000000:5;if(MODE==='mm2'){ITEMS=MM2_ITEMS;I=Object.fromEntries(ITEMS.map(i=>[i.id,i]))}};
const fm=n=>Math.floor(n).toLocaleString('en-US');
// PS99 pets from BIG Games' official API with RAP values and official thumbnails. Cached 1h.
const PSTTL=3600000;
async function psFetch(prev){
 const g=u=>fetch(u,{headers:{accept:'application/json'}}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()});
 const[col,rap]=await Promise.all([g('https://ps99.biggamesapi.io/api/collection/Pets'),g('https://ps99.biggamesapi.io/api/rap')]);
 const th={};for(const p of col.data||[]){const n=p.configName,t=p.configData&&p.configData.thumbnail;if(n&&t)th[n]=String(t).replace(/\D/g,'')}
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
let DBKEY=KEY; // the Redis key the CURRENT db was loaded from; persist() always writes back to this, never to whatever KEY is now
const load=async fresh=>{DBKEY=KEY;const s=await R('GET',DBKEY);db={users:{},sessions:{},shop:{},wd:[],dp:[],values:{},webhook:'',logs:[],jp:null,chat:[],cf:{open:[],recent:[],id:0},...(s?JSON.parse(s):{})};
 if(db._m&&db._m!==MODE)throw Error('Data mismatch ('+db._m+' data under '+MODE+'), refusing to continue');
 if(MODE==='ps99'){const mm=await R('GET','db');MAIN=mm?JSON.parse(mm):{users:{},sessions:{}};db.sessions=MAIN.sessions||{};await psLoad()}
 if(db.cb){for(const g of db.cb.open||[])for(const p of g.players)if(!p.bot&&db.users[p.id])db.users[p.id].tokens+=g.cost;delete db.cb} // case battles were removed: refund anything still open
 jp=db.jp||(db.jp={players:{},end:0,id:0,last:null});await wgLoad(fresh)};
// Device fingerprint: a salted, one-way hash of the request IP, stored per user so admins can see
// which accounts share a device (likely alts/ban evasion). Never the raw IP, never sent anywhere else.
const DEVSALT=process.env.DEVICE_SALT||'syncmm2-default-salt-change-me';
const getIp=req=>String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
const hashDev=ip=>ip?crypto.createHash('sha256').update(DEVSALT+ip).digest('hex').slice(0,20):'';
function altGroups(){const by={};for(const u of Object.values(db.users)){if(!u.dev)continue;(by[u.dev]=by[u.dev]||[]).push(u.name)}
 return Object.values(by).filter(g=>g.length>1)}
const persist=async()=>{await R('SET',DBKEY,JSON.stringify(MODE==='ps99'?{...db,sessions:undefined,_m:MODE}:{...db,_m:MODE}));try{await wgFlush()}catch{}};
const save=()=>{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function mutate(fn){const t=crypto.randomBytes(8).toString('hex');let ok=0;
 for(let i=0;i<60&&!ok;i++){if(await R('SET','lock',t,'NX','PX',9000)==='OK')ok=1;else await sleep(100)}
 if(!ok)throw Error('Server busy, try again');
 try{await load(1);if(jp.end&&Date.now()>=jp.end)jpResolve();const out=await fn();await persist();return out}
 finally{if(await R('GET','lock')===t)await R('DEL','lock')}}
// ---- daily stats (UTC day) for the Home page ----
const dayKey=()=>new Date().toISOString().slice(0,10);
// ---- Ranks (Beginner / Rich / High Roller / King): ONE rank per Roblox player, shared by the MM2 and PS99 sites. ----
// Redis hash 'wgr' = {'m:<id>': lifetime tokens wagered on MM2, 'p:<id>': lifetime gems wagered on PS99, '_i': backfill flag}. persist() keeps your own site's field up to date,
// and the other site's field is read from here, so both sites always agree. A rank unlocks when EITHER side reaches its target (g = PS99 gems, t = MM2 tokens).
// rb = TOTAL rakeback % on your own bets at that rank (replaces the base rate). rfx = extra referral % added to the base REF_PCT, with the total capped at REF_CAP (1.5% of the bet).
const REF_CAP=0.015;
const RANKS=[
 {k:'beginner',n:'Beginner',g:250e6,t:100,rb:0.007,rfx:0.002},
 {k:'rich',n:'Rich',g:2.5e9,t:500,rb:0.01,rfx:0.005},
 {k:'highroller',n:'High Roller',g:10e9,t:2500,rb:0.01,rfx:0.01},
 {k:'king',n:'King',g:50e9,t:25000,rb:0.03,rfx:0.03}];
const rkRb=id=>{const r=rankInfo(id);return r.lvl?r.rb:RB_PCT};
const rkRf=id=>rankInfo(id).rf;
let WG={},WGT=0;
async function wgLoad(fresh){
 if(!fresh&&WGT&&Date.now()-WGT<8000)return;
 let a=await R('HGETALL','wgr');const m={};
 if(Array.isArray(a)){for(let i=0;i+1<a.length;i+=2)m[a[i]]=a[i+1]}else if(a&&typeof a==='object')Object.assign(m,a);
 if(!m._i){ // first run: copy everyone's existing lifetime wagered from both databases
  const args=[];
  for(const[key,pre]of[['db','m:'],['dbps','p:']]){const raw=await R('GET',key);if(!raw)continue;let d;try{d=JSON.parse(raw)}catch{continue}
   for(const u of Object.values(d.users||{})){const v=Math.floor(u.wagered||0);if(v>0){m[pre+u.id]=v;args.push(pre+u.id,String(v))}}}
  for(let i=0;i<args.length;i+=400)await R('HSET','wgr',...args.slice(i,i+400));
  await R('HSET','wgr','_i','1');m._i=1}
 for(const k of Object.keys(m))m[k]=Number(m[k])||0;
 WG=m;WGT=Date.now()}
async function wgFlush(){const pre=MODE==='ps99'?'p:':'m:',args=[];
 for(const u of Object.values(db.users)){const v=Math.floor(u.wagered||0),k=pre+u.id;if(WG[k]!==v&&(v>0||WG[k])){WG[k]=v;args.push(k,String(v))}}
 for(let i=0;i<args.length;i+=400)await R('HSET','wgr',...args.slice(i,i+400))}
// Everything about one player's rank: both wager totals, current rank, bonus, and progress to the next one.
function rankInfo(id,full){
 id=String(id);const u=db.users[id],own=u?Math.floor(u.wagered||0):(WG[(MODE==='ps99'?'p:':'m:')+id]||0),oth=WG[(MODE==='ps99'?'m:':'p:')+id]||0;
 const p=MODE==='ps99'?own:oth,m=MODE==='ps99'?oth:own;
 let lvl=0;RANKS.forEach((r,i)=>{if(p>=r.g||m>=r.t)lvl=i+1});
 const cur=lvl?RANKS[lvl-1]:null,nx=RANKS[lvl]||null;
 const o={lvl,k:cur?cur.k:'',n:cur?cur.n:'',rb:cur?cur.rb:RB_PCT,rf:Math.min(REF_CAP,REF_PCT+(cur?cur.rfx:0)),p:Math.floor(p),m:Math.floor(m)};
 if(full){o.next=nx?{k:nx.k,n:nx.n,g:nx.g,t:nx.t,needG:Math.max(0,Math.ceil(nx.g-p)),needT:Math.max(0,Math.ceil(nx.t-m)),pct:Math.min(1,Math.max(p/nx.g,m/nx.t)),rb:nx.rb,rf:Math.min(REF_CAP,REF_PCT+nx.rfx)}:null;
  o.tiers=RANKS.map(r=>({k:r.k,n:r.n,g:r.g,t:r.t,rb:r.rb,rf:Math.min(REF_CAP,REF_PCT+r.rfx)}))}
 return o}
// ---- Rewards: referrals + rakeback. Every bet in every game goes through rec(), so both accrue there.
// Referral: the referrer earns REF_PCT of every bet their referred players make (u.ref={by,t,w:wagered via referral,e:earned for referrer}); referrer's pending balance = r.refP (lifetime r.refT).
// Rakeback: every player earns RB_PCT of their own wagers back (u.rb pending, u.rbT lifetime). Both are claimed into the balance. Override with env REFERRAL_PCT / RAKEBACK_PCT (decimals: 0.01 = 1%).
const REF_PCT=Number(process.env.REFERRAL_PCT)>0?Number(process.env.REFERRAL_PCT):0.01,RB_PCT=process.env.RAKEBACK_PCT?Math.max(0,Number(process.env.RAKEBACK_PCT)||0):0.005;
// Referral milestone bonus: each referred player who wagered at least REF_MIN_W pays the referrer a one-time bonus (150M gems on PS99 / 35 tokens on MM2).
// The referrer must have a linked Discord to claim, and the bonus goes into the wager lock. Env: REF_BONUS_GEMS, REF_BONUS_TOKENS, REF_BONUS_MIN_WAGER.
const refBonus=()=>MODE==='ps99'?(Number(process.env.REF_BONUS_GEMS)||150000000):(Number(process.env.REF_BONUS_TOKENS)||35);
const refMinW=()=>process.env.REF_BONUS_MIN_WAGER?Number(process.env.REF_BONUS_MIN_WAGER)||0:MINB*10;
const refQual=u=>{const m=refMinW();let n=0;for(const x of Object.values(db.users))if(x.ref&&x.ref.by===u.id&&(x.ref.w||0)>=m)n++;return n};
const accrue=(u,bet)=>{if(!(bet>0))return;const rb=bet*(rkRb(u.id));u.rb=(u.rb||0)+rb;u.rbT=(u.rbT||0)+rb;
 if(u.ref&&u.ref.by){const r=db.users[u.ref.by];if(r&&r.id!==u.id){const e=bet*rkRf(r.id);u.ref.w=(u.ref.w||0)+bet;u.ref.e=(u.ref.e||0)+e;r.refP=(r.refP||0)+e;r.refT=(r.refT||0)+e}}};
const rec=(u,bet,pay,game,info)=>{accrue(u,bet);if(game){(u.hist=u.hist||[]).push({g:game,bet,pay,t:Date.now(),i:info||''});if(u.hist.length>150)u.hist=u.hist.slice(-150)}const d=dayKey(),s=db.day&&db.day.d===d?db.day:(db.day={d,w:{},p:{},n:0,names:{},best:null});
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
const CH={logins:['🔐 Logins',0x5b8def],coinflip:['🪙 Coinflip',0xf5c542],jackpot:['🎰 Jackpot',0xb47cff],blackjack:['🃏 Blackjack',0x22c55e],mines:['💣 Mines',0xef4444],towers:['🗼 Towers',0x38bdf8],upgrader:['⬆️ Upgrader',0xa855f7],colordice:['🎲 Colour Dice',0xf43f5e],roulette:['🎡 Roulette',0x10b981],tips:['🎁 Tips',0xff7ab8],exchange:['🔄 Exchange',0x2dd4bf],withdrawals:['📤 Withdrawals & Deposits',0xf59e0b],admin:['🛠️ Admin',0x94a3b8]};
const WHRE=/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
let SITE='',HQ=[];
const md=s=>String(s??'').replace(/([\\*_`~|>\[\]])/g,'\\$1'),cut=(s,n)=>{s=String(s);return s.length>n?s.slice(0,n-1)+'…':s};
const cur=()=>MODE==='ps99'?'gems':'tokens',nm=k=>(I[k]||{name:k}).name;
const strCodes=id=>Object.entries(db.codes||{}).filter(([k,c])=>c.cr===id).map(([k,c])=>({code:k,tokens:c.tokens||0,max:c.max||0,used:Object.keys(c.by||{}).length,exp:c.exp||0,off:!!c.off,t:c.t||0,note:c.note||''})).sort((x,y)=>y.t-x.t);
const RF=new Map();const codeList=()=>Object.entries(db.codes||{}).map(([k,c])=>({code:k,tokens:c.tokens||0,items:c.items||{},max:c.max||0,used:Object.keys(c.by||{}).length,exp:c.exp||0,off:!!c.off,note:c.note||'',t:c.t||0})).sort((x,y)=>y.t-x.t);
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
// Amounts accept plain numbers or shorthand: 50m, 1.5b, 250k, 2t, 50,000,000
const UNIT={k:1e3,m:1e6,mil:1e6,million:1e6,b:1e9,bil:1e9,billion:1e9,t:1e12,trillion:1e12},MAXAMT=9e15;
const amt=x=>{if(typeof x==='number')return Number.isFinite(x)?Math.min(Math.floor(x),MAXAMT):NaN;
 const m=String(x??'').trim().toLowerCase().replace(/[,_\s]/g,'').match(/^([+-]?(?:\d+\.?\d*|\.\d+))([a-z]*)$/);if(!m)return NaN;
 const u=m[2]?UNIT[m[2]]:1;if(!u)return NaN;const n=Math.round(+m[1]*u*1e6)/1e6;return Number.isFinite(n)?Math.min(Math.floor(n),MAXAMT):NaN};
const needInt=(n,min=1)=>{n=amt(n);if(!(n>=min))E('Invalid amount');return n};
const findUser=s=>{s=String(s??'').trim();const l=s.toLowerCase();let t=db.users[s]||Object.values(db.users).find(u=>u.name.toLowerCase()===l);
 if(!t&&MODE==='ps99'&&MAIN){const mu=(MAIN.users||{})[s]||Object.values(MAIN.users||{}).find(x=>x.name.toLowerCase()===l);if(mu)t=db.users[mu.id]={id:mu.id,name:mu.name,avatar:mu.avatar,tokens:0,inv:{},wagered:0,profit:0,mines:null,lastSeen:0}}
 return t||E('User not found')};

// ---- Admin passwords: scrypt-hashed in Redis ('admpw'), set/removed ONLY by the Owner. Admins can sign in with the Roblox bio code OR their password. ----
const scr=(p,s)=>new Promise((ok,no)=>crypto.scrypt(p,s,32,{N:16384,r:8,p:1},(e,k)=>e?no(e):ok(k)));
const pwMap=async()=>{try{const r=await R('GET','admpw');return r?JSON.parse(r):{}}catch{return{}}};
const pwOk=async(rec,p)=>{const k=await scr(String(p),Buffer.from(rec?rec.s:'00'.repeat(16),'hex'));return!!rec&&crypto.timingSafeEqual(k,Buffer.from(rec.h,'hex'))}; // always hashes, so timing doesn't reveal whether the account exists
const pwThrottle=async ks=>{for(const k of ks)if(+(await R('GET','pwf:'+k)||0)>=5)E('Too many attempts. Try again in 15 minutes.')};
const pwFail=async ks=>{for(const k of ks){const n=await R('INCR','pwf:'+k);if(n===1)await R('EXPIRE','pwf:'+k,900)}};
async function pwLogin(b,H,req){
 const un=String(b.username||'').trim().toLowerCase().slice(0,40),pw=String(b.password||'').slice(0,200);
 if(!un||!pw)E('Enter your username and password');
 const dev=hashDev(getIp(req)),ks=['i'+dev,'u'+un.replace(/[^a-z0-9_]/g,'')];
 await pwThrottle(ks);await load();
 const t=Object.values(db.users).find(x=>x.name.toLowerCase()===un||x.id===un),rec=t&&ADMINS.includes(t.id)?(await pwMap())[t.id]:null;
 if(!(await pwOk(rec,pw))){await pwFail(ks);E('Wrong username or password')}
 await R('DEL','pwf:'+ks[1]);
 {const bn=banHit(await getBans(),t.id,dev);if(bn)E(banMsg(bn))}
 return mutate(async()=>{const u=db.users[t.id]||E('Wrong username or password');u.lastSeen=Date.now();if(dev)u.dev=dev;
  const s=crypto.randomBytes(24).toString('hex');db.sessions[s]=u.id;
  H['Set-Cookie']=`sid=${s}; HttpOnly; Secure; Path=/; Max-Age=604800; SameSite=Lax`;log(`🔑 ${u.name} logged in with admin password`);
  hk('logins',{title:'Admin password login',color:0xf59e0b,user:{avatar:u.avatar},desc:`${ulink(u)} signed in with a password`,fields:[['Roblox ID',u.id,1],['Location',flag(dd(req.headers['x-vercel-ip-country']))+geoOf(req),1],['IP address','`'+(getIp(req)||'unknown')+'`',1],['Browser',cut(req.headers['user-agent']||'',180)]]});
  return{ok:true}})}
const admList=(PW,AS)=>ADMINS.map(id=>{const u=db.users[id]||(MAIN&&MAIN.users&&MAIN.users[id]);return{id,rm:!isOwner(id)&&!ADMIN_ENV.includes(id),name:u?u.name:((AS&&AS[id]&&AS[id].name)||id),avatar:u?u.avatar:'',owner:isOwner(id),pw:!!PW[id],t:PW[id]?PW[id].t:0,known:!!db.users[id]}});

// ---- Leaderboard: live stats + admin overrides (db.lbx = {over:{wagered:{key:{id?,name,avatar,v}},profit:{...}}, hide:{id:1}}). Overrides replace a player's value or add a custom entry; hidden players vanish from every board. ----
const LBN=25;
function lbRows(k){const x=db.lbx||{},hide=x.hide||{},ov=(x.over||{})[k]||{},rows=[];
 for(const u of Object.values(db.users)){if(hide[u.id]||ov[u.id])continue;const v=Math.floor(u[k]||0);if(v>0)rows.push({id:u.id,name:u.name,avatar:u.avatar,v})}
 for(const o of Object.values(ov)){const u=o.id&&db.users[o.id];if(o.id&&hide[o.id])continue;rows.push(u?{id:u.id,name:u.name,avatar:u.avatar,v:Math.floor(o.v)}:{id:'',name:o.name,avatar:o.avatar||'',v:Math.floor(o.v),custom:1})}
 return rows.sort((a,b)=>b.v-a.v)}
function lbToday(){const s=db.day&&db.day.d===dayKey()?db.day:null,hide=(db.lbx&&db.lbx.hide)||{};if(!s)return[];
 return Object.entries(s.p).filter(([id,v])=>v>0&&!hide[id]&&s.names[id]).map(([id,v])=>({id,name:s.names[id][0],avatar:s.names[id][1],v:Math.floor(v)})).sort((a,b)=>b.v-a.v)}
function lbView(sid){const uid=db.sessions[sid],all={wagered:lbRows('wagered'),profit:lbRows('profit'),today:lbToday()},boards={},me={};
 for(const[k,l]of Object.entries(all)){boards[k]=l.slice(0,LBN);const i=uid?l.findIndex(r=>r.id===uid):-1;me[k]=i>=0?{rank:i+1,v:l[i].v}:null}
 return{boards,me,total:Object.keys(db.users).length}}
const lbAdm=()=>{const x=db.lbx||{},ov=k=>Object.entries((x.over||{})[k]||{}).map(([key,o])=>{const u=o.id&&db.users[o.id];return{key,id:o.id||'',name:u?u.name:o.name,avatar:u?u.avatar:(o.avatar||''),v:Math.floor(o.v),custom:!o.id}});
 return{wagered:ov('wagered'),profit:ov('profit'),hide:Object.keys(x.hide||{}).map(id=>{const u=db.users[id];return{id,name:u?u.name:id,avatar:u?u.avatar:''}})}};

// ---- Blackjack (server-side deck; dealer hole card is never sent until the hand ends) ----
const BJR=['A','2','3','4','5','6','7','8','9','10','J','Q','K'],BJS=['♠','♥','♦','♣'];
const bjDeck=()=>{const d=[];for(const s of BJS)for(const r of BJR)d.push(r+s);for(let i=d.length-1;i>0;i--){const j=crypto.randomInt(i+1);[d[i],d[j]]=[d[j],d[i]]}return d};
const bjTot=h=>{let t=0,a=0;for(const c of h){const r=c.slice(0,-1);if(r==='A'){a++;t+=11}else t+=('JQK'.includes(r)||r==='10')?10:+r}while(t>21&&a){t-=10;a--}return t};
const bjView=g=>({id:g.id,bet:g.bet,player:g.p,dealer:g.done?g.d:[g.d[0],null],pv:bjTot(g.p),dv:g.done?bjTot(g.d):bjTot([g.d[0]]),done:g.done,result:g.result||null,payout:g.payout||0,doubled:!!g.dbl,canDouble:!g.done&&g.p.length===2&&!g.dbl});
function bjEnd(u,g,res){g.done=true;g.result=res;g.payout=res==='bj'?Math.floor(g.bet*2.5):res==='win'?g.bet*2:res==='push'?g.bet:0;
 u.tokens+=g.payout;u.wagered+=g.bet;u.profit+=g.payout-g.bet;rec(u,g.bet,g.payout,'blackjack',`${res} · You ${bjTot(g.p)} vs Dealer ${bjTot(g.d)}`);log(`🃏 ${u.name} blackjack ${res} (bet ${g.bet}, paid ${g.payout})`);HR('blackjack',u,'Blackjack',g.bet,g.payout,[['Result',res,1],['Hands',`You ${bjTot(g.p)} · Dealer ${bjTot(g.d)}`,1]])}
function bjDealer(u,g){while(bjTot(g.d)<17)g.d.push(g.k.pop());const p=bjTot(g.p),d=bjTot(g.d);bjEnd(u,g,d>21||p>d?'win':p===d?'push':'lose')}
// ---- Coinflip (item vs item, resolved instantly when someone joins) ----
const cfClean=items=>{const o={};for(const[k,q]of Object.entries(items||{})){if(!I[k])E('Bad item');o[k]=needInt(q)}return o};
const cfTok=t=>{const n=amt(t);return n>0?n:0};
// Resolve a coinflip: J = {user|null (null = SyncBot), items, tokens, value}. 3 coins, best of 3. 10% tax (tokens first, then cheapest items) -> shop.
function cfResolve(g,J){const cu=db.users[g.c.id],bot=!J.user,jSide=g.side==='heads'?'tails':'heads';
 const flips=[0,1,2].map(()=>crypto.randomInt(2)?'heads':'tails'),res=flips.filter(x=>x==='heads').length>=2?'heads':'tails',winC=res===g.side;
 const total=g.value+J.value,pot={};for(const it of[g.items,J.items])for(const[k,q]of Object.entries(it))add(pot,k,q);
 let ptok=(g.tokens||0)+J.tokens;const cap=total*.1;let tx=Math.min(Math.floor(cap),ptok);ptok-=tx;
 const units=[];Object.entries(pot).forEach(([k,q])=>{for(let i=0;i<q;i++)units.push(k)});units.sort((x,y)=>val(x)-val(y));
 for(const k of units){if(tx+val(k)<=cap){tx+=val(k);add(pot,k,-1);add(db.shop,k,1)}else break}
 const wu=winC?cu:J.user;
 if(wu){Object.entries(pot).forEach(([k,q])=>add(wu.inv,k,q));wu.tokens+=ptok}else Object.entries(pot).forEach(([k,q])=>add(db.shop,k,q));
 cu.wagered+=g.value;cu.profit+=(winC?total-tx:0)-g.value;rec(cu,g.value,winC?total-tx:0,'coinflip',`#${g.id} vs ${bot?'SyncBot':J.user.name} · ${flips.join('/')} → ${res} · ${winC?'Won':'Lost'}`);if(J.user){J.user.wagered+=J.value;J.user.profit+=(winC?0:total-tx)-J.value;rec(J.user,J.value,winC?0:total-tx,'coinflip',`#${g.id} vs ${g.c.name} · ${flips.join('/')} → ${res} · ${winC?'Lost':'Won'}`)}
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
 P.forEach(([id,p])=>{const u=db.users[id];u.wagered+=p.value;u.profit+=(id===w[0]?got:0)-p.value;rec(u,p.value,id===w[0]?got:0,'jackpot',id===w[0]?'Won the pot':'Lost')});
 jp.last={rid:++jp.id,t:Date.now(),winner:w[0],name:w[1].name,total,taxed:s,snap:P.map(([id,p])=>({id,name:p.name,value:p.value}))};
 jp.players={};jp.end=0;log(`🎰 Jackpot #${jp.id}: ${w[1].name} won ${got} value (pot ${total}, tax ${s})`);
 hk('jackpot',{title:`Jackpot #${jp.id} · ${w[1].name} won`,color:0x22c55e,user:{avatar:w[1].avatar},desc:`${ulink({id:w[0],name:w[1].name})} took the pot`,fields:[['Pot',fm(total)+' '+cur(),1],['Tax',fm(s)+' '+cur(),1],['Winner gets',fm(got)+' '+cur(),1],['Players',P.map(([,p])=>`${md(p.name)} — ${fm(p.value)} (${(p.value/total*100).toFixed(1)}%)`).join('\n')]]})}
const mult=(m,n)=>{let x=.97;for(let k=0;k<n;k++)x*=(25-k)/(25-m-k);return x};

// ---- Colour Dice (token bet, red vs blue, each rolls a d6, higher wins, ties reroll; vs player or SyncBot) ----
const CDT=.05,cdDb=()=>db.cd||(db.cd={open:[],recent:[],id:0});
function cdResolve(g,J){const D=cdDb(),cu=db.users[g.c.id],bot=!J.user,jc=g.col==='red'?'blue':'red',rounds=[];let a,b;do{a=crypto.randomInt(1,7);b=crypto.randomInt(1,7);rounds.push([a,b])}while(a===b&&rounds.length<20);
 const winC=a>b,pot=g.bet*2,tx=Math.floor(pot*CDT),got=pot-tx;
 if(winC)cu.tokens+=got;else if(J.user)J.user.tokens+=got;
 cu.wagered+=g.bet;cu.profit+=(winC?got:0)-g.bet;rec(cu,g.bet,winC?got:0,'colordice',`#${g.id} vs ${bot?'SyncBot':J.user.name} · ${g.col} ${a} - ${b} ${jc} · ${winC?'Won':'Lost'}`);
 if(J.user){J.user.wagered+=g.bet;J.user.profit+=(winC?0:got)-g.bet;rec(J.user,g.bet,winC?0:got,'colordice',`#${g.id} vs ${g.c.name} · ${jc} ${b} - ${a} ${g.col} · ${winC?'Lost':'Won'}`)}
 const jn=bot?{id:'bot',name:'SyncBot',avatar:'/logo.png',bot:1}:{id:J.user.id,name:J.user.name,avatar:J.user.avatar},w=winC?{id:g.c.id,name:g.c.name,avatar:g.c.avatar}:jn;
 D.open=D.open.filter(x=>x!==g);const rc={id:g.id,c:g.c,j:jn,cCol:g.col,jCol:jc,rounds,a,b,winner:w,bet:g.bet,won:got,t:Date.now()};D.recent.push(rc);D.recent=D.recent.slice(-20);
 log(`🎲 Colour Dice #${g.id}: ${w.name} won ${got} (${g.c.name} ${a} vs ${b} ${jn.name})`);
 hk('colordice',{title:`Colour Dice #${g.id} · ${w.name} won`,color:0x22c55e,user:w,desc:`${md(g.c.name)} (${g.col}) vs ${md(jn.name)}${bot?' 🤖':''} (${jc})\\nRolls: ${rounds.map(r=>r.join('-')).join(' · ')}`,fields:[['Pot',fm(pot)+' '+cur(),1],['Tax',fm(tx)+' '+cur(),1],['Winner gets',fm(got)+' '+cur(),1]]});return rc}
// ---- Roulette (European, single zero, one bet per spin) ----
const RRED=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],RT={red:[2,n=>RRED.includes(n)],black:[2,n=>n>0&&!RRED.includes(n)],odd:[2,n=>n>0&&n%2===1],even:[2,n=>n>0&&n%2===0],low:[2,n=>n>=1&&n<=18],high:[2,n=>n>=19],d1:[3,n=>n>=1&&n<=12],d2:[3,n=>n>=13&&n<=24],d3:[3,n=>n>=25],num:[36,(n,p)=>n===p]};
// ---- Towers (PS99 only): climb 8 floors, one safe tile per floor. Bomb layout is hidden server-side until the game ends. ----
const TWD={easy:[4,1],medium:[3,1],hard:[2,1],expert:[3,2]},TWR=8; // [tiles per floor, bombs per floor]
const twMult=(d,n)=>.97*Math.pow(TWD[d][0]/(TWD[d][0]-TWD[d][1]),n);
function twCash(u){const g=u.tw,pay=Math.floor(g.bet*twMult(g.d,g.picks.length));u.tokens+=pay;u.wagered+=g.bet;u.profit+=pay-g.bet;rec(u,g.bet,pay,'towers',`${g.d} · ${g.picks.length}/${TWR} floors · ${twMult(g.d,g.picks.length).toFixed(2)}x`);u.tw=null;HR('towers',u,'Towers',g.bet,pay,[['Difficulty',g.d,1],['Floors',g.picks.length+' / '+TWR,1],['Multiplier',twMult(g.d,g.picks.length).toFixed(2)+'x',1]]);
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
 {const bn=banHit(await getBans(),p.id,dev);if(bn)E(banMsg(bn))}
 return mutate(async()=>{const isNew=!db.users[p.id];const same=Object.values(db.users).filter(x=>dev&&x.id!==p.id&&x.dev===dev).map(x=>x.name);const u=db.users[p.id]||(db.users[p.id]={id:p.id,name:p.name,avatar:'',tokens:0,inv:{},wagered:0,profit:0,mines:null});
  u.name=p.name;u.avatar=av;if(dev)u.dev=dev;u.lastSeen=Date.now();const s=crypto.randomBytes(24).toString('hex');db.sessions[s]=p.id;await R('DEL','p:'+b.tok);
  H['Set-Cookie']=`sid=${s}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`;log(`✅ ${p.name} logged in`);hk('logins',{title:isNew?'New account':'Login',color:same.length?0xef4444:isNew?0x22c55e:undefined,user:{avatar:av},desc:`${ulink(p)} signed in`,fields:[['Roblox ID',p.id,1],['Location',flag(dd(req.headers['x-vercel-ip-country']))+geoOf(req),1],['IP address','`'+(getIp(req)||'unknown')+'`',1],['Device ID',dev?'`'+dev.slice(0,10)+'`':'',1],['⚠️ Shares a device with',same.map(md).join(', ')],['Browser',cut(req.headers['user-agent']||'',180)]]});return{ok:true}})}

const admData=(WC,own)=>{const us=Object.values(db.users),tk=us.reduce((s,x)=>s+(x.tokens||0),0),iv=us.reduce((s,x)=>s+invVal(x),0),sv=Object.entries(db.shop).reduce((s,[k,q])=>s+val(k)*q,0),now=Date.now();
 return{wd:db.wd.filter(w=>w.status==='pending'),wdDone:db.wd.filter(w=>w.status!=='pending').slice(-30).reverse(),dp:db.dp.filter(w=>w.status==='pending'),dpDone:db.dp.filter(w=>w.status!=='pending').slice(-30).reverse(),wh:own?whView(WC):undefined,logs:own?db.logs.slice(-100).reverse():undefined,alts:own?altGroups():undefined,codes:codeList(),
  stats:{players:us.length,online:us.filter(x=>now-(x.lastSeen||0)<45000).length,tokens:Math.floor(tk),invValue:Math.floor(iv),shopValue:Math.floor(sv),pending:db.wd.filter(w=>w.status==='pending').length+db.dp.filter(w=>w.status==='pending').length,
   cfOpen:db.cf.open.length,jpPlayers:Object.keys(jp.players).length,mines:us.filter(x=>x.mines).length,tw:us.filter(x=>x.tw).length,bj:us.filter(x=>x.bj&&!x.bj.done).length,todayN:db.day&&db.day.d===dayKey()?db.day.n:0,todayWag:db.day&&db.day.d===dayKey()?Math.floor(Object.values(db.day.w).reduce((a,c)=>a+c,0)):0},
  cf:db.cf.open.map(g=>({id:g.id,name:g.c.name,value:g.value})),values:Object.keys(db.values).map(k=>({id:k,v:db.values[k]})),lb:lbAdm()}};
const admPlayer=(t,own)=>({id:t.id,name:t.name,avatar:t.avatar,tokens:Math.floor(t.tokens||0),invValue:Math.floor(invVal(t)),wagered:Math.floor(t.wagered||0),profit:Math.floor(t.profit||0),lastSeen:t.lastSeen||0,
 inv:Object.entries(t.inv||{}).filter(([k])=>I[k]).map(([k,q])=>({id:k,q})),games:{mines:!!t.mines,tw:!!t.tw,bj:!!(t.bj&&!t.bj.done),jp:!!jp.players[t.id],cf:db.cf.open.filter(g=>g.c.id===t.id).length},
 alts:own&&t.dev?Object.values(db.users).filter(x=>x.id!==t.id&&x.dev===t.dev).map(x=>x.name):[]});
async function handle(a,b,sid,H){
 if(a==='lb')return lbView(sid);
 const uid0=db.sessions[sid];let u=db.users[uid0];
 if(MODE==='ps99'&&uid0&&MAIN.users[uid0]){const mu=MAIN.users[uid0];
  u=db.users[uid0]||(db.users[uid0]={id:uid0,name:mu.name,avatar:mu.avatar,tokens:0,inv:{},wagered:0,profit:0,mines:null,lastSeen:Date.now()});
  u.name=mu.name;u.avatar=mu.avatar;if(mu.dev)u.dev=mu.dev}
 if(u&&a!=='logout'&&a!=='admreturn'&&!(b.asid&&ADMINS.includes(db.sessions[b.asid]))){const bh=banHit(await getBans(),u.id,CURDEV);if(bh){if(a==='state')return{banned:{reason:bh.reason||''}};E('You are banned from this site')}}
 if(a==='state'){
  if(!u)return{guest:true};const admin=ADMINS.includes(u.id),m=u.mines,now=Date.now(),WC=isOwner(u.id)?await whCfg():{},STR=await getStreamers(),DC=await dcGet(u.id);
  const online=Object.values(db.users).filter(x=>now-(x.lastSeen||0)<45000).map(x=>({id:x.id,name:x.name,avatar:x.avatar}));
  const activeMines=Object.values(db.users).filter(x=>x.mines).map(x=>({name:x.name,avatar:x.avatar,bet:x.mines.bet,m:x.mines.m,open:x.mines.open.length}));
  return{me:{id:u.id,name:u.name,avatar:u.avatar,tokens:u.tokens,inv:u.inv,invValue:invVal(u),admin,owner:isOwner(u.id),streamer:!!STR[u.id],wlock:wlLeft(u),rw:{rb:Math.floor(u.rb||0),rbT:Math.floor(u.rbT||0),ref:Math.floor(u.refP||0),refT:Math.floor(u.refT||0),by:u.ref&&u.ref.by&&db.users[u.ref.by]?{id:u.ref.by,name:db.users[u.ref.by].name}:null,pr:rkRf(u.id),pb:rkRb(u.id),pr0:REF_PCT,pb0:RB_PCT,bonus:{amt:refBonus(),minw:refMinW(),q:refQual(u),paid:u.refBC||0,dc:!!DC,dcOn:dcOn()}},role:roleOf(u.id,STR),rk:rankInfo(u.id,1),discord:DC,dcOn:dcOn(),imp:!!b.asid&&ADMINS.includes(db.sessions[b.asid])},
   day:dayPub(),mode:MODE,minb:MINB,iv:IV(),items:(b.iv===IV())?null:ITEMS.map(i=>({...i,value:val(i.id)})),shop:db.shop,jp:jpPub(),cf:{open:db.cf.open,recent:db.cf.recent.slice(-10),now:Date.now()},cd:{open:cdDb().open,recent:cdDb().recent.slice(-10)},
   bj:u.bj?bjView(u.bj):null,
   mines:m&&{bet:m.bet,m:m.m,open:m.open,mult:mult(m.m,m.open.length)},
   tw:u.tw?{bet:u.tw.bet,d:u.tw.d,picks:u.tw.picks,mult:twMult(u.tw.d,u.tw.picks.length)}:null,
   wd:db.wd.filter(w=>w.uid===u.id).slice(-10),dp:db.dp.filter(w=>w.uid===u.id).slice(-10),tips:(db.tips||[]).filter(x=>x.from.id===u.id||x.to.id===u.id).slice(-15),
   online,activeMines,chat:(db.chat||[]).slice(-50).map(m=>m.sys?m:{...m,r:roleOf(m.uid,STR),k:rankInfo(m.uid).k}),
   streamer:STR[u.id]?{codes:strCodes(u.id)}:undefined,
   admin:admin?Object.assign(admData(WC,isOwner(u.id)),isOwner(u.id)?{admins:admList(await pwMap(),await getAdminStore()),streamers:Object.values(STR)}:{}):undefined}}
 if(!u)E('Please log in');
 if(a==='logout'){delete db.sessions[sid];H['Set-Cookie']='asid=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax';return{ok:1}}
 if(a==='dclink'){if(!dcOn())E('Discord linking is not set up yet — the Owner needs to add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET');
  return{url:'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,redirect_uri:dcRedirect(),response_type:'code',scope:'identify',prompt:'consent',state:dcSign({u:String(u.id),e:Date.now()+600000})})}}
 if(a==='dcunlink'){const old=await dcGet(u.id);if(old){await R('HDEL','dclinks',String(u.id));await R('HDEL','dcby',old.id)}return{ok:1}}
 if(a==='chatsend'){const msg=String(b.msg||'').trim().slice(0,300);if(!msg)E('Empty message');
  db.chat=db.chat||[];const last=db.chat[db.chat.length-1];
  if(last&&last.uid===u.id&&Date.now()-last.t<1500)E('Slow down');
  db.chat.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,avatar:u.avatar,msg,t:Date.now()});u.lastChat=Date.now();
  db.chat=db.chat.slice(-50);return{ok:1}}
 if(a==='reflist'){const rows=Object.values(db.users).filter(x=>x.ref&&x.ref.by===u.id).map(x=>({id:x.id,name:x.name,avatar:x.avatar,w:Math.floor(x.ref.w||0),e:Math.round((x.ref.e||0)*100)/100,t:x.ref.t||0,q:(x.ref.w||0)>=refMinW()})).sort((x,y)=>y.w-x.w);
  return{list:rows.slice(0,200),n:rows.length,w:rows.reduce((q,x)=>q+x.w,0),e:Math.floor(u.refT||0),pend:Math.floor(u.refP||0)}}
 if(a==='refset'){if(u.ref&&u.ref.by)E('You already have a referrer');const k=String(b.code||'').trim().replace(/^@/,'');if(!k)E('Enter a username or Roblox ID');
  let t=null;try{t=findUser(k)}catch{}if(!t)E('Player not found');
  if(t.id===u.id)E('You cannot refer yourself');
  if(u.dev&&t.dev&&u.dev===t.dev)E('You cannot use a referrer on the same device');
  if(t.ref&&t.ref.by===u.id)E('That player was referred by you');
  u.ref={by:t.id,t:Date.now(),w:0,e:0};log(`🤝 ${u.name} was referred by ${t.name}`);return{ok:1,msg:'Referrer set: '+t.name}}
 if(a==='rwclaim'){const k=b.k==='ref'?'ref':'rb',key=k==='ref'?'refP':'rb',n=Math.floor(u[key]||0);if(n<1)E('Nothing to claim yet — keep playing');
  u[key]=(u[key]||0)-n;u.tokens=(u.tokens||0)+n;wlAdd(u,n);log(`🎁 ${u.name} claimed ${fm(n)} ${cur()} ${k==='ref'?'referral earnings':'rakeback'}`);return{ok:1,n,msg:`Claimed ${fm(n)} ${cur()} (wager-locked: play 90% of it before withdrawing)`}}
 if(a==='refbonus'){if(!(await dcGet(u.id)))E('Link your Discord account in Settings to claim this bonus');const q=refQual(u),c=q-(u.refBC||0);if(c<1)E(`No bonus ready — each referral must wager ${fm(refMinW())} ${cur()} first`);
  const pay=c*refBonus();u.refBC=(u.refBC||0)+c;u.tokens=(u.tokens||0)+pay;wlAdd(u,pay);log(`🎁 ${u.name} claimed referral bonus: ${c} referral(s) = ${fm(pay)} ${cur()}`);return{ok:1,msg:`Claimed ${fm(pay)} ${cur()} for ${c} referral${c>1?'s':''} (wager-locked)`}}
 if(a==='redeem'){const code=String(b.code||'').trim().toUpperCase().replace(/\s+/g,'');if(!code)E('Enter a code');
  const now=Date.now(),L=(RF.get(u.id)||[]).filter(t=>now-t<60000);if(L.length>=8)E('Too many tries, wait a minute');
  db.codes=db.codes||{};const c=db.codes[code];
  if(!c||c.off||(c.mode&&c.mode!==MODE)){L.push(now);RF.set(u.id,L);E('Invalid code')}
  if(c.exp&&now>c.exp)E('This code has expired');
  c.by=c.by||{};if(c.by[u.id])E('You already redeemed this code');
  if(c.max&&Object.keys(c.by).length>=c.max)E('This code has been fully claimed');
  c.by[u.id]=now;const ls=[];
  if(c.tokens>0){u.tokens=(u.tokens||0)+c.tokens;ls.push(`${fm(c.tokens)} ${cur()}`);
   if(MODE==='ps99'){const add2=Math.ceil(c.tokens*WAGER_LOCK);u.wl={base:u.wagered||0,req:wlLeft(u)+add2};ls.push(`wager ${fm(wlLeft(u))} to unlock withdrawals`)}}
  for(const[k,q]of Object.entries(c.items||{})){if(!I[k])continue;add(u.inv,k,q);ls.push(`${fm(q)}× ${nm(k)}`)}
  const n=Object.keys(c.by).length;log(`🎟️ ${u.name} redeemed code ${code} (${ls.join(', ')})`);
  hk('admin',{title:'Code redeemed',user:u,desc:`${ulink(u)}\nredeemed **${md(code)}** (${c.max?n+'/'+c.max:n} claimed)\n${ls.join(', ')}`});
  return{ok:1,msg:'Redeemed: '+ls.join(', ')}}
 if(a.startsWith('str')){const STR=await getStreamers();if(!STR[u.id])E('Streamers only');db.codes=db.codes||{};
  if(a==='strmake'){let code=String(b.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,24);if(!code)code=crypto.randomBytes(4).toString('hex').toUpperCase();if(db.codes[code])E('That code already exists');
   if(strCodes(u.id).length>=50)E('You have too many codes — delete some first');
   const tk=amt(b.tokens);if(!(tk>0))E('Enter a '+cur()+' amount');
   const max=Math.floor(+b.max);if(!(max>=1)||max>10000)E('Set how many people can claim it (1–10,000)');
   const hrs=b.hours?+b.hours:0;if(!(hrs>=0)||hrs>87600)E('Invalid expiry');
   const note=String(b.note||'').trim().slice(0,40);
   db.codes[code]={mode:MODE,tokens:tk,items:{},max,exp:hrs?Date.now()+hrs*3600000:0,note:'🎥 '+u.name+(note?' · '+note:''),by:{},t:Date.now(),off:0,cr:u.id};
   log(`🎥 Streamer ${u.name} created code ${code} (${fm(tk)} ${cur()}, first ${max})`);hk('admin',{title:'Streamer code created',user:u,desc:`${ulink(u)}\ncreated **${md(code)}**\n${fm(tk)} ${cur()} · first ${max} people${hrs?` · ${hrs}h`:''}`});return{ok:1,code}}
  const k=String(b.code||'').toUpperCase(),c=db.codes[k];if(!c||c.cr!==u.id)E('Code not found');
  if(a==='stroff'){c.off=!c.off;log(`🎥 Streamer ${u.name} ${c.off?'disabled':'enabled'} code ${k}`);return{ok:1}}
  if(a==='strdel'){delete db.codes[k];log(`🎥 Streamer ${u.name} deleted code ${k}`);return{ok:1}}
  E('Unknown action')}
 if(!db.cf)db.cf={open:[],recent:[],id:0};
 const take=(items,types)=>{let v=0;for(const[k,q]of Object.entries(items||{})){const n=needInt(q);if(!I[k])E('Bad item');if(types&&!types.includes(I[k].type))E('Item not allowed here');if((u.inv[k]||0)<n)E('You do not own that');v+=val(k)*n}
  for(const[k,q]of Object.entries(items))add(u.inv,k,-q);return v};
 // ---- Player search / profiles. Only public stats are returned: never the device hash, session, active game state or lastChat. Alts are shown to admins only. ----
 if(a==='history'){const gm=String(b.game||'');return{h:(u.hist||[]).filter(x=>!gm||x.g===gm).slice(-50).reverse()}}
 if(a==='psearch'){const s=String(b.q||'').trim().toLowerCase().slice(0,40);if(!s)return{list:[]};
  const seen={},out=[];for(const x of Object.values(db.users).concat(MODE==='ps99'?Object.values(MAIN.users||{}):[])){if(seen[x.id])continue;seen[x.id]=1;
   if(x.name.toLowerCase().includes(s)||String(x.id)===s)out.push({id:x.id,name:x.name,avatar:x.avatar,w:db.users[x.id]?Math.floor(db.users[x.id].wagered||0):0})}
  const st=x=>x.name.toLowerCase().startsWith(s)?0:1;out.sort((x,y)=>st(x)-st(y)||y.w-x.w);return{list:out.slice(0,12)}}
 if(a==='profile'){const k=String(b.q||'').trim();let t=db.users[k]||Object.values(db.users).find(x=>x.name.toLowerCase()===k.toLowerCase()),fresh=0;
  if(!t&&MODE==='ps99'){const mu=(MAIN.users||{})[k]||Object.values(MAIN.users||{}).find(x=>x.name.toLowerCase()===k.toLowerCase());if(mu){t={id:mu.id,name:mu.name,avatar:mu.avatar,tokens:0,inv:{},wagered:0,profit:0,lastSeen:0};fresh=1}}
  if(!t)E('Player not found');
  const us=Object.values(db.users),rank=fresh?null:us.filter(x=>(x.wagered||0)>(t.wagered||0)).length+1,inv=Object.entries(t.inv||{}).filter(([k2])=>I[k2]).map(([k2,q])=>({id:k2,q,v:val(k2)})).sort((x,y)=>y.v*y.q-x.v*x.q),
   dy=db.day&&db.day.d===dayKey()?db.day:null,admin=isOwner(u.id);
  const PSTR=await getStreamers(),PDC=await dcGet(t.id);
  return{p:{role:roleOf(t.id,PSTR),rk:rankInfo(t.id,1),discord:PDC?{id:PDC.id,name:PDC.name,user:PDC.user,avatar:PDC.avatar}:null,id:t.id,name:t.name,avatar:t.avatar,balance:Math.floor(t.tokens||0),invValue:invVal(t),wagered:Math.floor(t.wagered||0),profit:Math.floor(t.profit||0),
   rank,players:us.length,pieces:inv.reduce((n,x)=>n+x.q,0),kinds:inv.length,top:inv.slice(0,10),online:Date.now()-(t.lastSeen||0)<45000,lastSeen:t.lastSeen||0,
   todayWag:dy?Math.floor(dy.w[t.id]||0):0,todayProfit:dy?Math.floor(dy.p[t.id]||0):0,
   alts:admin&&t.dev?us.filter(x=>x.id!==t.id&&x.dev===t.dev).map(x=>x.name):undefined}}}
 if(a==='sell'){const n=needInt(b.qty),v=take({[b.item]:n}),t=Math.floor(v*.9);u.tokens+=t;add(db.shop,b.item,n);log(`💱 ${u.name} sold ${n}x ${b.item} for ${t} ${cur()}`);hk('exchange',{title:'Sold to shop',user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(b.item)}`,1],['Received',fm(t)+' '+cur(),1]]});return{ok:1}}
 if(a==='buy'){const n=needInt(b.qty);if(!I[b.item]||(db.shop[b.item]||0)<n)E('Out of stock');const p=Math.ceil(val(b.item)*1.1)*n;
  if(u.tokens<p)E('Not enough '+cur());u.tokens-=p;add(db.shop,b.item,-n);add(u.inv,b.item,n);log(`🛒 ${u.name} bought ${n}x ${b.item} for ${p}`);hk('exchange',{title:'Bought from shop',color:0x2dd4bf,user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(b.item)}`,1],['Paid',fm(p)+' '+cur(),1]]});return{ok:1}}
 if(a==='jpjoin'){if(!b.items||!Object.keys(b.items).length)E('Select items');
  const v=take(b.items);if(MODE==='ps99'&&v<MINB)E('Minimum jackpot entry is '+fm(MINB));const p=jp.players[u.id]||(jp.players[u.id]={name:u.name,avatar:u.avatar,items:{},value:0});
  for(const[k,q]of Object.entries(b.items))add(p.items,k,q);p.value+=v;
  if(Object.keys(jp.players).length>=2&&!jp.end)jp.end=Date.now()+25000;return{ok:1}}
 if(a==='jpleave'){const p=jp.players[u.id];if(!p||Object.keys(jp.players).length>1)E('Cannot leave now');for(const[k,q]of Object.entries(p.items))add(u.inv,k,q);delete jp.players[u.id];return{ok:1}}
 if(a==='bjstart'){if(u.bj&&!u.bj.done)E('Finish your current hand first');const bet=needInt(b.bet);if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+(MODE==='ps99'?'gems':'tokens'));
  u.tokens-=bet;const k=bjDeck(),p1=k.pop(),d1=k.pop(),p2=k.pop(),d2=k.pop(),g=u.bj={id:Date.now(),bet,k,p:[p1,p2],d:[d1,d2],done:false};
  const pb=bjTot(g.p)===21,db_=bjTot(g.d)===21;if(pb||db_)bjEnd(u,g,pb&&db_?'push':pb?'bj':'lose');return{ok:1}}
 if(a==='bjhit'||a==='bjstand'||a==='bjdouble'){const g=u.bj;if(!g||g.done)E('No active hand');
  if(a==='bjstand')bjDealer(u,g);
  else{if(a==='bjdouble'){if(g.p.length!==2||g.dbl)E('Cannot double now');if(u.tokens<g.bet)E('Not enough '+cur()+' to double');u.tokens-=g.bet;g.bet*=2;g.dbl=1}
   g.p.push(g.k.pop());const t=bjTot(g.p);if(t>21)bjEnd(u,g,'bust');else if(t===21||g.dbl)bjDealer(u,g)}
  return{ok:1}}
 if(a==='cfcreate'){const items=cfClean(b.items),tk=cfTok(b.tokens),side=b.side==='tails'?'tails':'heads';
  if(db.cf.open.filter(g=>g.c.id===u.id).length>=3)E('Max 3 open coinflips');if(u.tokens<tk)E('Not enough '+cur());
  const iv=cfVal(items);if(iv+tk<MINB)E('Minimum offer is '+fm(MINB));take(items);u.tokens-=tk;
  db.cf.open.push({id:++db.cf.id,c:{id:u.id,name:u.name,avatar:u.avatar},side,items,tokens:tk,value:iv+tk,t:Date.now()});
  log(`🪙 ${u.name} created coinflip #${db.cf.id} (${iv+tk} value, ${side})`);hk('coinflip',{title:`Coinflip #${db.cf.id} posted`,color:0x94a3b8,user:u,desc:`${ulink(u)} picked **${side}**`,fields:[['Offer',itl(items,tk),1],['Value',fm(iv+tk)+' '+cur(),1],['Join range',cfRange(iv+tk).map(fm).join(' – '),1]]});return{ok:1,id:db.cf.id}}
 if(a==='cfcancel'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game not found');if(g.c.id!==u.id)E('Not your game');
  for(const[k,q]of Object.entries(g.items))add(u.inv,k,q);u.tokens+=g.tokens||0;db.cf.open=db.cf.open.filter(x=>x!==g);return{ok:1}}
 if(a==='cfjoin'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id===u.id)E('Cannot join your own game');
  const items=cfClean(b.items),tk=cfTok(b.tokens),jv=cfVal(items)+tk,[lo,hi]=cfRange(g.value);if(!jv)E('Select items or tokens');if(jv<lo||jv>hi)E(`Your offer must be worth ${lo}-${hi}`);
  if(u.tokens<tk)E('Not enough '+cur());take(items);u.tokens-=tk;cfResolve(g,{user:u,items,tokens:tk,value:jv});return{ok:1,id:g.id}}
 if(a==='cfbot'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id!==u.id)E('Only the creator can call SyncBot');
  cfResolve(g,{user:null,items:{},tokens:g.value,value:g.value});return{ok:1,id:g.id}}
 if(a==='minesstart'){if(u.mines)E('Game in progress');const bet=needInt(b.bet),m=needInt(b.m);if(m<1||m>24)E('Pick 1-24 mines');if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+(MODE==='ps99'?'gems':'tokens'));
  u.tokens-=bet;const mines=[];while(mines.length<m){const x=crypto.randomInt(25);if(!mines.includes(x))mines.push(x)}
  u.mines={bet,m,mines,open:[]};return{ok:1}}
 if(a==='minespick'){const g=u.mines;if(!g)E('No game');const i=needInt(b.i,0);if(i>24||g.open.includes(i))E('Invalid tile');
  if(g.mines.includes(i)){u.wagered+=g.bet;u.profit-=g.bet;rec(u,g.bet,0,'mines',`${g.m} mines · hit a mine after ${g.open.length} gems`);u.mines=null;HR('mines',u,'Mines',g.bet,0,[['Mines',g.m,1],['Gems found',g.open.length,1],['Result','Hit a mine',1]]);return{boom:true,mines:g.mines,open:g.open}}
  g.open.push(i);if(g.open.length===25-g.m)return minesCash(u);return{safe:true}}
 if(a==='minescash'){if(!u.mines||!u.mines.open.length)E('Pick a tile first');return minesCash(u)}
 if(a==='withdraw'){if(wlLeft(u)>0)E(`Wager ${fm(wlLeft(u))} more ${cur()} to unlock withdrawals (90% of claimed rewards/code ${cur()})`);const n=needInt(b.qty);take({[b.item]:n},MODE==='ps99'?['pet']:['gun','knife','pet']);db.wd.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,item:b.item,qty:n,status:'pending',t:Date.now()});
  log(`📤 Withdraw request: ${u.name} ${n}x ${b.item}`);hk('withdrawals',{title:'Withdrawal requested',user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(b.item)}`,1],['Value',fm(val(b.item)*n)+' '+cur(),1],['Roblox ID',u.id,1]]});return{ok:1}}
 if(a==='depositgems'){if(MODE!=='ps99')E('Gem deposits are PS99 only');const n=needInt(b.gems,MINB);
  if(db.dp.filter(x=>x.uid===u.id&&x.status==='pending').length>=25)E('Too many pending deposits — wait for them to be reviewed');
  db.dp.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,item:'',qty:1,gems:n,status:'pending',t:Date.now()});
  log(`📥 Gem deposit request: ${u.name} ${fm(n)} gems`);hk('withdrawals',{title:'Gem deposit requested',color:0x38bdf8,user:u,desc:ulink(u),fields:[['Gems','💎 '+fm(n),1],['Roblox ID',u.id,1]]});return{ok:1}}
 if(a==='deposit'){const n=needInt(b.qty),k=String(b.item||'');if(!I[k])E('Bad item');if(!(MODE==='ps99'?['pet']:['gun','knife','pet']).includes(I[k].type))E('Item not allowed here');
  if(db.dp.filter(x=>x.uid===u.id&&x.status==='pending').length>=25)E('Too many pending deposits — wait for them to be reviewed');
  db.dp.push({id:crypto.randomBytes(4).toString('hex'),uid:u.id,name:u.name,item:k,qty:n,status:'pending',t:Date.now()});
  log(`📥 Deposit request: ${u.name} ${n}x ${k}`);hk('withdrawals',{title:'Deposit requested',color:0x38bdf8,user:u,desc:ulink(u),fields:[['Item',`${n}× ${nm(k)}`,1],['Value',fm(val(k)*n)+' '+cur(),1],['Roblox ID',u.id,1]]});return{ok:1}}


 if(a==='tip'){const k=String(b.to||'').trim();let t=db.users[k]||Object.values(db.users).find(x=>x.name.toLowerCase()===k.toLowerCase());
  if(!t&&MODE==='ps99'){const mu=MAIN.users[k]||Object.values(MAIN.users).find(x=>x.name.toLowerCase()===k.toLowerCase());if(mu)t=db.users[mu.id]={id:mu.id,name:mu.name,avatar:mu.avatar,tokens:0,inv:{},wagered:0,profit:0,mines:null,lastSeen:0}}
  if(!t)E('Player not found. They need to have logged in once.');if(t.id===u.id)E('You cannot tip yourself');
  const items=cfClean(b.items),tk=cfTok(b.tokens);if(!tk&&!Object.keys(items).length)E('Pick '+(MODE==='ps99'?'gems or pets':'tokens or items')+' to tip');if(u.tokens<tk)E('Not enough '+cur());
  if(wlLeft(u)>0)E(`Wager ${fm(wlLeft(u))} more ${cur()} before you can tip (wager lock)`);
  const iv=take(items);u.tokens-=tk;t.tokens+=tk;for(const[x,q]of Object.entries(items))add(t.inv,x,q);
  (db.tips=db.tips||[]).push({id:crypto.randomBytes(4).toString('hex'),from:{id:u.id,name:u.name,avatar:u.avatar},to:{id:t.id,name:t.name,avatar:t.avatar},items,tokens:tk,value:iv+tk,t:Date.now()});db.tips=db.tips.slice(-200);
  log(`🎁 ${u.name} tipped ${t.name} (${iv+tk} value)`);
  hk('tips',{title:'Tip sent',user:t,color:u.dev&&u.dev===t.dev?0xef4444:undefined,desc:`${ulink(u)} → ${ulink(t)}`,fields:[['Gems / tokens',tk?fm(tk)+' '+cur():'',1],['Items',Object.keys(items).length?itl(items,0):'',1],['Total value',fm(iv+tk)+' '+cur(),1],['⚠️ Same device','These two accounts share a device — possible alt transfer.']]});
  return{ok:1}}
 
 if(a==='twstart'){if(u.tw)E('Game in progress');const bet=needInt(b.bet),d=TWD[b.diff]?b.diff:'medium',[c,k]=TWD[d];if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+cur());
  u.tokens-=bet;const bombs=[];for(let r=0;r<TWR;r++){const row=[];while(row.length<k){const x=crypto.randomInt(c);if(!row.includes(x))row.push(x)}bombs.push(row)}
  u.tw={bet,d,bombs,picks:[]};return{ok:1}}
 if(a==='twpick'){const g=u.tw;if(!g)E('No game');const i=needInt(b.i,0);if(i>=TWD[g.d][0])E('Invalid tile');
  if(g.bombs[g.picks.length].includes(i)){u.wagered+=g.bet;u.profit-=g.bet;rec(u,g.bet,0,'towers',`${g.d} · bomb on floor ${g.picks.length+1}`);u.tw=null;HR('towers',u,'Towers',g.bet,0,[['Difficulty',g.d,1],['Floors',g.picks.length+' / '+TWR,1],['Result','Hit a bomb on floor '+(g.picks.length+1),1]]);log(`🗼 ${u.name} hit a bomb in towers (bet ${g.bet}, floor ${g.picks.length+1}, ${g.d})`);return{boom:true,bombs:g.bombs,picks:g.picks.concat(i),d:g.d}}
  g.picks.push(i);if(g.picks.length===TWR)return twCash(u);return{safe:true}}
 if(a==='upgrade'){const bet=needInt(b.bet),mu=Math.round(+b.mult*100)/100;if(!(mu>=1.1&&mu<=100))E('Pick a multiplier between 1.1x and 100x');if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+cur());
  const ch=.97/mu,roll=crypto.randomInt(1e6)/1e6,win=roll<ch,pay=win?Math.floor(bet*mu):0;u.tokens+=pay-bet;u.wagered+=bet;u.profit+=pay-bet;rec(u,bet,pay,'upgrader',`${mu.toFixed(2)}x · ${(ch*100).toFixed(2)}% · ${win?'Upgraded':'Failed'}`);
  HR('upgrader',u,'Upgrader',bet,pay,[['Multiplier',mu.toFixed(2)+'x',1],['Chance',(ch*100).toFixed(2)+'%',1],['Result',win?'Upgraded':'Failed',1]]);log(`⬆️ ${u.name} upgrade ${mu.toFixed(2)}x ${win?'won':'lost'} (bet ${bet})`);
  return{win,roll,chance:ch,mult:mu,pay}}
 if(a==='cdcreate'){const D=cdDb(),bet=needInt(b.bet),col=b.col==='blue'?'blue':'red';if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+cur());if(D.open.filter(g=>g.c.id===u.id).length>=3)E('Max 3 open dice games');
  u.tokens-=bet;D.open.push({id:++D.id,c:{id:u.id,name:u.name,avatar:u.avatar},col,bet,t:Date.now()});log(`🎲 ${u.name} created colour dice #${D.id} (${bet}, ${col})`);
  hk('colordice',{title:`Colour Dice #${D.id} posted`,color:0x94a3b8,user:u,desc:`${ulink(u)} picked **${col}**`,fields:[['Bet',fm(bet)+' '+cur(),1]]});return{ok:1,id:D.id}}
 if(a==='cdcancel'){const D=cdDb(),g=D.open.find(x=>x.id===+b.id)||E('Game not found');if(g.c.id!==u.id)E('Not your game');u.tokens+=g.bet;D.open=D.open.filter(x=>x!==g);return{ok:1}}
 if(a==='cdjoin'){const D=cdDb(),g=D.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id===u.id)E('Cannot join your own game');if(u.tokens<g.bet)E('Not enough '+cur());u.tokens-=g.bet;return{ok:1,r:cdResolve(g,{user:u})}}
 if(a==='cdbot'){const D=cdDb(),g=D.open.find(x=>x.id===+b.id)||E('Game already taken');if(g.c.id!==u.id)E('Only the creator can call SyncBot');return{ok:1,r:cdResolve(g,{user:null})}}
 if(a==='cdbotplay'){const D=cdDb(),bet=needInt(b.bet),col=b.col==='blue'?'blue':'red';if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+cur());u.tokens-=bet;const g={id:++D.id,c:{id:u.id,name:u.name,avatar:u.avatar},col,bet,t:Date.now()};D.open.push(g);return{ok:1,r:cdResolve(g,{user:null})}}
 if(a==='rlspin'){const bet=needInt(b.bet),k=String(b.kind||''),t=RT[k]||E('Bad bet'),pk=k==='num'?needInt(b.pick,0):0;if(k==='num'&&pk>36)E('Pick 0-36');if(bet<MINB)E('Minimum bet is '+fm(MINB));if(u.tokens<bet)E('Not enough '+cur());
  const n=crypto.randomInt(37),col=n===0?'green':RRED.includes(n)?'red':'black',win=t[1](n,pk),pay=win?bet*t[0]:0;u.tokens+=pay-bet;u.wagered+=bet;u.profit+=pay-bet;rec(u,bet,pay,'roulette',`${k==='num'?'#'+pk:k} · landed ${n} ${col} · ${win?'Won':'Lost'}`);
  HR('roulette',u,'Roulette',bet,pay,[['Bet',k==='num'?'Number '+pk:k,1],['Landed',n+' '+col,1]]);log(`🎡 ${u.name} roulette ${k} ${win?'won':'lost'} (bet ${bet}, landed ${n})`);return{ok:1,n,col,win,pay,bet}}
 if(a==='twcash'){if(!u.tw||!u.tw.picks.length)E('Climb a floor first');return twCash(u)}
 if(a==='admreturn'){const o=b.asid&&db.sessions[b.asid];if(!o||!ADMINS.includes(o))E('Not impersonating');
  const tn=u.name;delete db.sessions[sid];H['Set-Cookie']=[`sid=${b.asid}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`,'asid=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax'];
  const ad=db.users[o]||(MAIN&&MAIN.users[o])||{id:o,name:o,avatar:''};log(`🛠️ ${ad.name} returned from ${tn}'s account`);hk('admin',{title:'Admin action',user:ad,desc:`${ulink(ad)}\nreturned from **${md(tn)}**'s account`});return{ok:1}}
 if(a.startsWith('adm')){if(!ADMINS.includes(u.id))E('Not admin');if(OWNER_ONLY.has(a)&&!isOwner(u.id))E('Only the Owner can do that');
  const logA=m=>{log(m);if(a!=='admwhtest')hk('admin',{title:'Admin action',user:u,desc:`${ulink(u)}\n${m.replace(/^\S+\s/,'')}`})};
  const iname=k=>(I[k]||{name:k}).name,cn=cur();
  if(a==='admgive'){const t=findUser(b.user),src=b.items&&typeof b.items==='object'?b.items:{[b.item]:b.qty},ls=[];
   const ent=Object.entries(src);if(!ent.length)E('Pick at least one item');
   for(const[k,q]of ent){if(!I[k])E('Bad item');needInt(q)}
   for(const[k,q]of ent){const n=needInt(q);add(t.inv,k,n);ls.push(`${fm(n)}× ${iname(k)}`)}
   logA(`🛠️ ${u.name} gave ${ls.join(', ')} to ${t.name}`)}
  else if(a==='admtake'){const t=findUser(b.user),k=b.item;if(!I[k])E('Bad item');const n=needInt(b.qty),have=t.inv[k]||0;add(t.inv,k,-Math.min(n,have));logA(`🛠️ ${u.name} removed ${fm(Math.min(n,have))}× ${iname(k)} from ${t.name}`)}
  else if(a==='admset'){const t=findUser(b.user);if(!I[b.item])E('Bad item');const q=amt(b.qty);if(!(q>=0))E('Invalid amount');delete t.inv[b.item];if(q)t.inv[b.item]=q;logA(`🛠️ ${u.name} set ${t.name}'s ${iname(b.item)} to ${fm(q)}`)}
  else if(a==='admtokens'){const t=findUser(b.user),n=amt(b.amount);if(!Number.isFinite(n)||n===0)E('Invalid amount');t.tokens=Math.max(0,(t.tokens||0)+n);logA(`🛠️ ${u.name} ${n>0?'added':'removed'} ${fm(Math.abs(n))} ${cn} ${n>0?'to':'from'} ${t.name}`)}
  else if(a==='admsetbal'){const t=findUser(b.user),n=amt(b.amount);if(!(n>=0))E('Invalid amount');t.tokens=n;logA(`🛠️ ${u.name} set ${t.name}'s ${cn} to ${fm(n)}`)}
  else if(a==='admvalue'){if(!I[b.item])E('Bad item');const n=amt(b.value);if(!(n>=1))E('Invalid value');db.values[b.item]=n;logA(`🛠️ ${u.name} set value of ${iname(b.item)} to ${fm(n)}`)}
  else if(a==='admvalreset'){if(!I[b.item])E('Bad item');delete db.values[b.item];logA(`🛠️ ${u.name} reset value of ${iname(b.item)} to default`)}
  else if(a==='admshop'){if(!I[b.item])E('Bad item');const n=amt(b.qty);if(!(n>=0))E('Invalid amount');const k=b.item;if(b.mode==='add')add(db.shop,k,n);else{delete db.shop[k];if(n)db.shop[k]=n}logA(`🛠️ ${u.name} ${b.mode==='add'?'added':'set'} shop stock of ${iname(k)} ${b.mode==='add'?'+':'to '}${fm(n)}`)}
  else if(a==='admcodemake'){db.codes=db.codes||{};let code=String(b.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,24);if(!code)code=crypto.randomBytes(4).toString('hex').toUpperCase();if(db.codes[code])E('That code already exists');
   const tk=b.tokens?amt(b.tokens):0;if(!(tk>=0))E('Invalid '+cn+' amount');const items={};
   for(const[k,q]of Object.entries(b.items&&typeof b.items==='object'?b.items:{})){if(!I[k])E('Bad item');items[k]=needInt(q)}
   if(!tk&&!Object.keys(items).length)E('Add a reward: '+cn+' or items');
   const max=b.max?Math.floor(+b.max):0;if(!(max>=0)||max>1e6)E('Invalid claim limit');const hrs=b.hours?+b.hours:0;if(!(hrs>=0)||hrs>87600)E('Invalid expiry');
   db.codes[code]={mode:MODE,tokens:tk,items,max,exp:hrs?Date.now()+hrs*3600000:0,note:String(b.note||'').slice(0,60),by:{},t:Date.now(),off:0};
   logA(`🛠️ ${u.name} created code ${code} (${itl(items,tk).replace(/\n/g,', ')}${max?`, first ${max} people`:''}${hrs?`, ${hrs}h`:''})`)}
  else if(a==='admcodedel'){const k=String(b.code||'').toUpperCase();if(!(db.codes&&db.codes[k]))E('Code not found');delete db.codes[k];logA(`🛠️ ${u.name} deleted code ${k}`)}
  else if(a==='admcodeoff'){const k=String(b.code||'').toUpperCase(),c=db.codes&&db.codes[k];if(!c)E('Code not found');c.off=!c.off;logA(`🛠️ ${u.name} ${c.off?'disabled':'enabled'} code ${k}`)}
  else if(a==='admlogin'){const t=findUser(b.user);if(MODE!=='mm2')E('Login-as must run from the main site');
   if(ADMINS.includes(t.id)&&t.id!==u.id)E('Cannot log in as another admin');
   const s2=crypto.randomBytes(24).toString('hex');db.sessions[s2]=t.id;
   H['Set-Cookie']=[`sid=${s2}; HttpOnly; Secure; Path=/; Max-Age=43200; SameSite=Lax`,`asid=${sid}; HttpOnly; Secure; Path=/; Max-Age=43200; SameSite=Lax`];
   logA(`🛠️ ${u.name} logged in as ${t.name} (admin login-as)`)}
  else if(a==='admlist'){return{list:Object.values(db.users).map(x=>({id:x.id,name:x.name,avatar:x.avatar,tokens:Math.floor(x.tokens||0),invValue:Math.floor(invVal(x)),wagered:Math.floor(x.wagered||0),lastSeen:x.lastSeen||0})).sort((x,y)=>y.lastSeen-x.lastSeen).slice(0,500)}}
  else if(a==='admplayer'){const t=findUser(b.user),p=admPlayer(t,isOwner(u.id)),bn=(await getBans())[t.id];p.owner=isOwner(t.id);p.admin=ADMINS.includes(t.id);p.noip=!t.dev;p.ban=bn?{reason:bn.reason||'',adm:!!bn.adm}:null;return{p}}
  else if(a==='admcancelbj'){const t=findUser(b.user);if(t.bj&&!t.bj.done){t.tokens+=t.bj.bet;t.bj=null}logA(`🛠️ ${u.name} cancelled ${t.name}'s blackjack hand (refunded)`)}
  else if(a==='admcancelcf'){const g=db.cf.open.find(x=>x.id===+b.id)||E('Coinflip not found');const o=db.users[g.c.id];if(o){for(const[k,q]of Object.entries(g.items))add(o.inv,k,q);o.tokens+=g.tokens||0}db.cf.open=db.cf.open.filter(x=>x!==g);logA(`🛠️ ${u.name} cancelled coinflip #${g.id} (refunded)`)}
  else if(a==='admkick'){const t=findUser(b.user);let n=0;if(MODE==='mm2')for(const k of Object.keys(db.sessions))if(db.sessions[k]===t.id){delete db.sessions[k];n++}logA(`🛠️ ${u.name} force-logged-out ${t.name} (${n} sessions)`)}
  else if(a==='admcanceltw'){const t=findUser(b.user);if(t.tw){t.tokens+=t.tw.bet;t.tw=null}logA(`🛠️ ${u.name} cancelled ${t.name}'s towers game`)}
  else if(a==='admcanceljp'){jpRefund();logA(`🛠️ ${u.name} cancelled the jackpot (refunded)`)}
  else if(a==='admcancelmines'){const t=findUser(b.user);if(t.mines){t.tokens+=t.mines.bet;t.mines=null}logA(`🛠️ ${u.name} cancelled ${t.name}'s mines game`)}
  else if(a==='admwd'){const w=db.wd.find(x=>x.id===b.id&&x.status==='pending')||E('Not found');
   if(b.ok){w.status='approved'}else{w.status='rejected';add(db.users[w.uid].inv,w.item,w.qty)}log(`📤 ${u.name} ${w.status} withdrawal ${w.qty}x ${w.item} for ${w.name}`);hk('withdrawals',{title:'Withdrawal '+w.status,color:w.status==='approved'?0x22c55e:0xef4444,desc:`${md(w.name)} · ${w.qty}× ${nm(w.item)}\nHandled by ${ulink(u)}`})}
  else if(a==='admdp'){const w=db.dp.find(x=>x.id===b.id&&x.status==='pending')||E('Not found');
   const what=w.gems?fm(w.gems)+' gems':w.qty+'x '+w.item,whatN=w.gems?'💎 '+fm(w.gems)+' gems':w.qty+'× '+nm(w.item);
   if(b.ok){if(w.gems){const t=db.users[w.uid]||E('Player not found');t.tokens=(t.tokens||0)+w.gems;w.status='approved'}else{if(!I[w.item])E('Item no longer exists');const t=db.users[w.uid]||E('Player not found');add(t.inv,w.item,w.qty);w.status='approved'}}else w.status='rejected';
   log(`📥 ${u.name} ${w.status} deposit ${what} for ${w.name}`);hk('withdrawals',{title:'Deposit '+w.status,color:w.status==='approved'?0x22c55e:0xef4444,desc:`${md(w.name)} · ${whatN}\nHandled by ${ulink(u)}`})}
  else if(a==='admwh'){if(!CH[b.ch])E('Unknown channel');const url=String(b.url||'').trim();if(url&&!WHRE.test(url))E('That is not a Discord webhook URL');
   const c=await whCfg();if(url)c[b.ch]=url;else delete c[b.ch];await R('SET','whcfg',JSON.stringify(c));logA(`🔔 ${CH[b.ch][0]} webhook ${url?'updated':'removed'}`)}
  else if(a==='admwhtest'){if(!CH[b.ch])E('Unknown channel');const url=whUrl(await whCfg(),b.ch);if(!url)E('No webhook set for this channel');
   if(!await whPost(url,whBody(b.ch,[{title:'Webhook test',description:'✅ This channel is connected. Events for **'+CH[b.ch][0]+'** will appear here.',color:CH[b.ch][1],footer:{text:'Test sent by '+u.name},timestamp:new Date().toISOString()}])))E('Discord rejected the webhook')}
  else if(a==='admrepair'){ // cleans data polluted by the old MM2/PS99 mix-up. Works on whichever mode the admin is viewing.
   if(Array.isArray(b.reset)){const n=[];for(const id of b.reset.slice(0,50)){const t=db.users[String(id)];if(!t)continue;t.tokens=0;t.wagered=0;t.profit=0;n.push(t.name)}
    logA(`🛠️ ${u.name} zeroed balance/stats of ${n.join(', ')||'nobody'}`);return{ok:1,reset:n.length}}
   const lim=MODE==='mm2'?1e7:0,sus=[];let purged=0;const clean=o=>{for(const k of Object.keys(o||{}))if(!I[k]){delete o[k];purged++}};
   for(const x of Object.values(db.users)){clean(x.inv);if(lim&&(Math.abs(x.tokens)>lim||Math.abs(x.wagered)>lim*10||Math.abs(x.profit)>lim*10))sus.push({id:x.id,name:x.name,tokens:Math.floor(x.tokens),wagered:Math.floor(x.wagered),profit:Math.floor(x.profit)})}
   clean(db.shop);const bad=o=>Object.keys(o||{}).some(k=>!I[k]);
   const co=db.cf.open.length;db.cf.open=db.cf.open.filter(g=>!bad(g.items)&&!(lim&&g.value>lim));
   db.cf.recent=db.cf.recent.filter(g=>!bad(g.cItems)&&!bad(g.jItems)&&!(lim&&g.cValue+g.jValue>lim));
   if(Object.values(jp.players).some(p=>bad(p.items)||(lim&&p.value>lim))){jp.players={};jp.end=0;purged++}
   if(jp.last&&lim&&jp.last.total>lim)jp.last=null;
   const wn=db.wd.length;db.wd=db.wd.filter(w=>I[w.item]);db.dp=db.dp.filter(w=>I[w.item]);purged+=wn-db.wd.length+co-db.cf.open.length;db.day=null;
   logA(`🛠️ ${u.name} ran data repair (${purged} foreign entries removed, ${sus.length} suspicious players)`);return{ok:1,purged,sus}}
  else if(a==='admlbset'){const k=b.board;if(k!=='wagered'&&k!=='profit')E('Pick a board');const v=amt(b.value);if(!Number.isFinite(v))E('Invalid amount');
   const q=String(b.user??'').trim().slice(0,32);if(!q)E('Enter a player or a name');const x=db.lbx=db.lbx||{over:{},hide:{}};x.over=x.over||{};x.hide=x.hide||{};const ov=x.over[k]=x.over[k]||{};
   let t=null;try{t=findUser(q)}catch{}
   if(t){ov[t.id]={id:t.id,v};logA(`🏆 ${u.name} set ${t.name}'s ${k} leaderboard value to ${fm(v)}`)}
   else{const l=q.toLowerCase(),ex=Object.keys(ov).find(i=>!ov[i].id&&ov[i].name.toLowerCase()===l);if(!ex&&Object.keys(ov).length>=100)E('Too many custom entries');ov[ex||'c'+crypto.randomBytes(4).toString('hex')]={name:q,avatar:'',v};logA(`🏆 ${u.name} set custom leaderboard entry ${q} (${k}) to ${fm(v)}`)}}
  else if(a==='admlbdel'){const k=b.board,o=db.lbx&&db.lbx.over&&db.lbx.over[k]&&db.lbx.over[k][b.key];if(!o)E('Entry not found');delete db.lbx.over[k][b.key];logA(`🏆 ${u.name} removed leaderboard override for ${o.name||o.id} (${k})`)}
  else if(a==='admlbclear'){const k=b.board;if(k!=='wagered'&&k!=='profit')E('Pick a board');const n=Object.keys((db.lbx&&db.lbx.over&&db.lbx.over[k])||{}).length;if(db.lbx&&db.lbx.over)db.lbx.over[k]={};logA(`🏆 ${u.name} cleared ${n} ${k} leaderboard overrides`)}
  else if(a==='admlbhide'){const t=findUser(b.user),x=db.lbx=db.lbx||{over:{},hide:{}};x.hide=x.hide||{};if(b.hide===false)delete x.hide[t.id];else x.hide[t.id]=1;logA(`🏆 ${u.name} ${b.hide===false?'unhid':'hid'} ${t.name} ${b.hide===false?'on':'from'} the leaderboards`)}
  else if(a==='admban'){const t=findUser(b.user);
   if(isOwner(t.id))E('Owners cannot be banned');
   if(t.id===u.id)E('You cannot ban yourself');
   const tAdm=ADMINS.includes(t.id);if(tAdm&&!isOwner(u.id))E('Only the Owner can ban admins');
   const bans=await getBans();if(bans[t.id])E(t.name+' is already banned');
   const reason=String(b.reason||'').trim().slice(0,120);
   bans[t.id]={uid:t.id,name:t.name,avatar:t.avatar||'',dev:t.dev||'',reason,by:u.id,byName:u.name,t:Date.now(),adm:tAdm};
   await putBans(bans);
   logA(`🔨 ${u.name} IP-banned ${t.name}${reason?' ('+reason+')':''}${t.dev?'':' — account only, no IP on record yet'}`);return{ok:1,noip:!t.dev}}
  else if(a==='admunban'){const bans=await getBans(),k=String(b.uid||'').trim(),e=bans[k]||E('Ban not found');
   if(e.adm&&!isOwner(u.id))E('Only the Owner can unban admins');
   delete bans[k];await putBans(bans);logA(`✅ ${u.name} unbanned ${e.name}`)}
  else if(a==='admbans'){const bans=await getBans();return{list:Object.values(bans).sort((x,y)=>y.t-x.t).map(e=>({uid:e.uid,name:e.name,avatar:e.avatar,reason:e.reason,byName:e.byName,t:e.t,adm:!!e.adm,ip:!!e.dev}))}}
  else if(a==='admaddadmin'){let t=null;try{t=findUser(b.user)}catch{}let id,name;
   if(t){id=t.id;name=t.name}else{const k=String(b.user||'').trim();if(!/^\d{1,15}$/.test(k))E('Player not found — they must log in once, or enter their Roblox ID');const d=await rj('https://users.roblox.com/v1/users/'+k);if(!d||!d.name)E('Roblox user not found');id=String(d.id||k);name=d.name}
   if(ADMINS.includes(id))E(name+' is already an admin');const m=await getAdminStore();m[id]={id,name,t:Date.now(),by:u.id};await putAdminStore(m);logA(`🛡️ ${u.name} made ${name} an admin`)}
  else if(a==='admdeladmin'){const k=String(b.id||''),m=await getAdminStore();if(isOwner(k))E('Owners cannot be removed');if(ADMIN_ENV.includes(k)&&!m[k])E('Set in the ADMIN_IDS env var — remove it there');const e=m[k]||E('Admin not found');
   delete m[k];await putAdminStore(m);const M=await pwMap();if(M[k]){delete M[k];await R('SET','admpw',JSON.stringify(M))}logA(`🛡️ ${u.name} removed admin ${e.name||k}`)}
  else if(a==='admstreamer'){let t=null;try{t=findUser(b.user)}catch{}let id,name;
   if(t){id=t.id;name=t.name}else{const k=String(b.user||'').trim();if(!/^\d{1,15}$/.test(k))E('Player not found — they must log in once, or enter their Roblox ID');const d=await rj('https://users.roblox.com/v1/users/'+k);if(!d||!d.name)E('Roblox user not found');id=String(d.id||k);name=d.name}
   const m=await getStreamers();if(m[id])E(name+' is already a streamer');m[id]={id,name,t:Date.now(),by:u.id};await putStreamers(m);logA(`🎥 ${u.name} made ${name} a streamer`)}
  else if(a==='admstreamerdel'){const m=await getStreamers(),k=String(b.id||''),e=m[k]||E('Streamer not found');if(e.env)E('Set in the STREAMER_IDS env var — remove it there');delete m[k];await putStreamers(m);logA(`🎥 ${u.name} removed streamer ${e.name||k}`)}
  else if(a==='admpwset'||a==='admpwdel'){if(!isOwner(u.id))E('Only the Owner can manage admin passwords');
   const q=String(b.user??'').trim(),t=db.users[q]||Object.values(db.users).find(w=>w.name.toLowerCase()===q.toLowerCase()),tid=t?t.id:q;if(!ADMINS.includes(tid))E('That player is not an admin');
   const M=await pwMap(),tn=t?t.name:tid;
   if(a==='admpwset'){const pw=String(b.password??'');if(pw.length<8)E('Password must be at least 8 characters');if(pw.length>128)E('Password is too long');const sl=crypto.randomBytes(16);M[tid]={s:sl.toString('hex'),h:(await scr(pw,sl)).toString('hex'),t:Date.now()};logA(`🔒 ${u.name} set an admin password for ${tn}`)}
   else{delete M[tid];logA(`🔒 ${u.name} removed the admin password of ${tn}`)}
   await R('SET','admpw',JSON.stringify(M))}
  else E('Unknown');return{ok:1}}
 E('Unknown action')}
function minesCash(u){const g=u.mines,pay=Math.floor(g.bet*mult(g.m,g.open.length));u.tokens+=pay;u.wagered+=g.bet;u.profit+=pay-g.bet;rec(u,g.bet,pay,'mines',`${g.m} mines · ${g.open.length} gems · ${mult(g.m,g.open.length).toFixed(2)}x`);u.mines=null;
 log(`💣 ${u.name} cashed out mines for ${pay} (bet ${g.bet})`);HR('mines',u,'Mines',g.bet,pay,[['Mines',g.m,1],['Gems found',g.open.length,1],['Multiplier',mult(g.m,g.open.length).toFixed(2)+'x',1]]);return{cashed:pay,mines:g.mines,open:g.open}}

// Module-level state (MODE, KEY, db, ITEMS, jp...) is shared by every request this instance serves, so requests run one at a time.
// Without this, an MM2 request and a PS99 request overlapping would flip MODE/ITEMS/db under each other and mix tokens, gems, pets and items.
let QUEUE=Promise.resolve();
const exclusive=fn=>{const r=QUEUE.then(fn,fn);QUEUE=r.then(()=>{},()=>{});return r};
module.exports=(req,res)=>exclusive(()=>run(req,res));
const run=async(req,res)=>{
 const a=req.query.a,b=(req.body&&typeof req.body==='object')?req.body:{},H={};HQ.length=0;{const h=req.headers['x-forwarded-host']||req.headers.host;SITE=h?'https://'+h:''}
 CURDEV=hashDev(getIp(req));
 setMode(['start','check','pwlogin','logout','admlogin','admreturn','admkick'].includes(a)?'mm2':b.gm);
 const ck=Object.fromEntries((req.headers.cookie||'').split('; ').map(c=>c.split('='))),sid=ck.sid;b.asid=ck.asid||'';let out;
 if(a==='dcback')return dcBack(req,res,sid);
 try{
  if(!URL_||!TOK)E('Database not configured (Upstash env vars missing)');
  await syncAdmins();
  if(a==='start')out=await start(b);
  else if(a==='check')out=await check(b,H,req);
  else if(a==='pwlogin')out=await pwLogin(b,H,req);
  else if(a==='admlist'||a==='admplayer'||a==='admbans'||a==='reflist'){await load();out=await handle(a,b,sid,H)}
  else if(a==='lb'){await load();out=(jp.end&&Date.now()>=jp.end)?await mutate(()=>handle(a,b,sid,H)):await handle(a,b,sid,H)}
  else if(a==='state'){await load();const uid=db.sessions[sid];
   const needResolve=(jp.end&&Date.now()>=jp.end)||false,known=MODE==='ps99'?MAIN.users[uid]:db.users[uid],needTouch=uid&&known&&(!db.users[uid]||Date.now()-(db.users[uid].lastSeen||0)>20000);
   out=(needResolve||needTouch)?await mutate(()=>{if(needTouch){const uu=db.users[db.sessions[sid]];if(uu)uu.lastSeen=Date.now()}return handle(a,b,sid,H)}):await handle(a,b,sid,H)}
  else out=await mutate(()=>handle(a,b,sid,H));
 }catch(e){out={error:e.message||'Error'};HQ.length=0}
 await flushHooks();
 for(const k in H)res.setHeader(k,H[k]); // Set-Cookie may be an array
 res.setHeader('Cache-Control','no-store');res.status(200).json(out)};
  
