import { Redis } from "@upstash/redis";

// Vercel's Upstash integration injects KV_REST_API_URL / KV_REST_API_TOKEN
// (Redis.fromEnv() looks for UPSTASH_REDIS_REST_* by default, so map explicitly)
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});
const KEY = "debts-data";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const data = await redis.get(KEY);
      res.status(200).json({ data: data || null });
      return;
    }

    if (req.method === "POST") {
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid body" });
        return;
      }
      await redis.set(KEY, body);
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
}
