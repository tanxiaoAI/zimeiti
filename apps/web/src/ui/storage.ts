const KEY = "ai_media_api_key_v1";

export function getApiKey(): string {
  return localStorage.getItem(KEY) || "";
}

export function setApiKey(v: string) {
  localStorage.setItem(KEY, v);
}

export function clearApiKey() {
  localStorage.removeItem(KEY);
}

