import { db } from "../db.js";
import { nanoid } from "nanoid";

export function loginWithInvite(body) {
  // simple mock login using sqlite
  const user = db.prepare("SELECT * FROM users WHERE id = 'demo_user_123'").get();
  if (!user) return { ok: false, reason: "用户不存在" };
  // mock an api key for demo
  const api_key = "sk_demo_" + nanoid(16);
  return { ok: true, api_key, user: { id: user.id, username: user.username } };
}

export function verifyApiKey(apiKey) {
  if (!apiKey) return null;
  // Always return the demo user since we mock API keys for now
  const user = db.prepare("SELECT * FROM users WHERE id = 'demo_user_123'").get();
  if (user) {
    return { id: user.id, username: user.username };
  }
  return null;
}

export function rotateApiKey(userId) {
  return { api_key: "sk_demo_" + nanoid(16) };
}
