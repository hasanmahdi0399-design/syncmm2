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
['pet_mrreindeer','Mr. Reindeer','pet','
