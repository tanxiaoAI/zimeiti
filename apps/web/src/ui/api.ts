export type ApiOk<T> = { request_id: string; data: T; error: null };
export type ApiFail = { request_id: string; data: null; error: { code: string; message: string; details?: any } };
export type ApiResp<T> = ApiOk<T> | ApiFail;

export const API_BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8787";

function isFail<T>(x: ApiResp<T>): x is ApiFail {
  return (x as any).error != null;
}

export async function apiGet<T>(path: string, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: apiKey ? { "X-API-Key": apiKey } : {} });
  const json = (await res.json()) as ApiResp<T>;
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiPost<T>(path: string, body: any, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as ApiResp<T>;
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiPut<T>(path: string, body: any, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as ApiResp<T>;
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiPatch<T>(path: string, body: any, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as ApiResp<T>;
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiDelete<T>(path: string, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: apiKey ? { "X-API-Key": apiKey } : {}
  });
  const json = (await res.json()) as ApiResp<T>;
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

export async function apiUpload<T>(path: string, form: FormData, apiKey?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: apiKey ? { "X-API-Key": apiKey } : {}, body: form });
  const json = (await res.json()) as ApiResp<T>;
  if (isFail(json)) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data;
}

