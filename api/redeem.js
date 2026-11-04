import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

// TODO: replace with your real logic to add gems to the logged-in user
async function addGems(userId, amount) {
  // e.g. await redis.incrby(`gems:${userId}`, amount);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // TODO: get the logged-in user from your site's login/session
  const userId = null;
  if (!userId) return res.status(401).json({ error: "Log in first" });

  const code = String(req.body?.code || "").trim().toUpperCase();
  // GETDEL reads and deletes in one atomic step, so only the first person to use it wins
  const entry = await redis.getdel(`code:${code}`);
  if (!entry) return res.status(404).json({ error: "Invalid or already used code" });

  try {
    await addGems(userId, entry.amount);
  } catch (e) {
    await redis.set(`code:${code}`, entry); // put the code back if crediting failed
    return res.status(500).json({ error: "Try again" });
  }
  return res.json({ ok: true, amount: entry.amount });
}
