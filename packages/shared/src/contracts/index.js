import { ErrorCodes } from "./errors.js";

export { ErrorCodes };

export function ok(data, request_id) {
  return { request_id, data, error: null };
}

export function fail(error, request_id) {
  return { request_id, data: null, error };
}

