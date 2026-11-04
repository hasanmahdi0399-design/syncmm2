import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = Redis.fromEnv();

function validKey(header) {
  const expected = `Bearer ${process.env.BOT_API_KEY || ""}`;
  const a = Buffer.from(header || "");
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.BOT_API_KEY || !validKey(req.headers.authorization))
    return res.status(401).end();

  const { code, amount, discord_id } = req.body || {};
  if (!/^SF-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) ||
      !Number.isInteger(amount) || amount < 1)
    return res.status(400).end();

  // nx: never overwrite an existing code
  const ok = await redis.set(`code:${code}`, { amount, discord_id }, { nx: true });
  return res.status(ok ? 200 : 409).end();
    }
