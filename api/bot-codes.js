// api/bot-codes.js — receives claim codes from the Discord bot and adds them to the
// PS99 side of Sync's existing code system (db.codes in the 'dbps' Redis key).
// Uses the same Redis lock as index.js so it can never overwrite a game write.
const crypto = require('crypto');

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const R = async (...c) => {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(c) });
  const j = await r.json();
  if (j.error) throw Error('DB: ' + j.error);
  return j.result;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function authed(req) {
  const key = process.env.BOT_API_KEY || '';
  const a = Buffer.from(String(req.headers.authorization || ''));
  const b = Buffer.from('Bearer ' + key);
  return key.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!authed(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!URL_ || !TOK) return res.status(500).json({ error: 'Database not configured' });

  const { code, amount, discord_id } = req.body || {};
  if (!/^SF-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(String(code || '')) ||
      !Number.isInteger(amount) || amount < 1 || amount > 9e15)
    return res.status(400).json({ error: 'Bad request' });

  const token = crypto.randomBytes(8).toString('hex');
  let locked = false;
  try {
    for (let i = 0; i < 60 && !locked; i++) {
      if ((await R('SET', 'lock', token, 'NX', 'PX', 9000)) === 'OK') locked = true;
      else await sleep(100);
    }
    if (!locked) return res.status(503).json({ error: 'Server busy' });

    const raw = await R('GET', 'dbps');
    const db = raw ? JSON.parse(raw) : {};
    db.codes = db.codes || {};
    if (db.codes[code]) return res.status(409).json({ error: 'Code exists' });

    db.codes[code] = {
      mode: 'ps99', tokens: amount, items: {}, max: 1, exp: 0,
      note: 'Discord claim · ' + String(discord_id || '').slice(0, 20),
      by: {}, t: Date.now(), off: 0, wl: true
    };
    await R('SET', 'dbps', JSON.stringify(db));
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  } finally {
    if (locked) { try { if ((await R('GET', 'lock')) === token) await R('DEL', 'lock'); } catch {} }
  }
};
