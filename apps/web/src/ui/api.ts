export type ApiOk<T> = { request_id: string; data: T; error: null };
export type ApiFail = { request_id: string; data: null; error: { code: string; message: string; details?: any } };
export type ApiResp<T> = ApiOk<T> | ApiFail;

const envApiBase = String((import.meta as any).env?.VITE_API_BASE || "").trim();

// In production we should default to same-origin /api requests instead of a local dev server.
export const API_BASE = envApiBase || "";

function isFail<T>(x: ApiResp<T>): x is ApiFail {
  return (x as any).error != null;
}

async function readApiJson<T>(res: Response): Promise<ApiResp<T>> {
  const rawText = await res.text();
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html") || /^\s*<!doctype html/i.test(rawText) || /^\s*<html/i.test(rawText);

  if (isHtml) {
    throw new Error(`服务返回了 HTML 错误页(HTTP ${res.status})，可能是网关/反向代理异常`);
  }

  let json: ApiResp<T>;
  try {
    json = JSON.parse(rawText) as ApiResp<T>;
  } catch (_error) {
    throw new Error(`服务返回了非 JSON 响应(HTTP ${res.status})：${rawText.slice(0, 120) || "empty body"}`);
  }

  if (!res.ok && !isFail(json)) {
    throw new Error(`HTTP ${res.status}`);
  }

  return json;
}

export async function apiGet<T>(path: string, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: apiKey ? { "X-API-Key": apiKey } : {} });
  const json = await readApiJson<T>(res);
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiPost<T>(path: string, body: any, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    body: JSON.stringify(body)
  });
  const json = await readApiJson<T>(res);
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiPut<T>(path: string, body: any, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    body: JSON.stringify(body)
  });
  const json = await readApiJson<T>(res);
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiPatch<T>(path: string, body: any, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    body: JSON.stringify(body)
  });
  const json = await readApiJson<T>(res);
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiDelete<T>(path: string, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: apiKey ? { "X-API-Key": apiKey } : {}
  });
  const json = await readApiJson<T>(res);
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiUpload<T>(path: string, form: FormData, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: apiKey ? { "X-API-Key": apiKey } : {}, body: form });
  const json = await readApiJson<T>(res);
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}
