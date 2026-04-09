import { ErrorCodes } from "@ai-media/shared/errors";
import { fail } from "@ai-media/shared/contracts";
import { verifyApiKey } from "../services/authStore.js";

export function authApiKey(req, res, next) {
  const request_id = req.context?.requestId;
  const apiKey = req.header("X-API-Key");
  if (!apiKey) {
    res.status(401).json(fail({ code: ErrorCodes.AUTH_MISSING, message: "缺少X-API-Key" }, request_id));
    return;
  }
  const verified = verifyApiKey(apiKey);
  if (!verified) {
    res.status(403).json(fail({ code: ErrorCodes.AUTH_INVALID, message: "API Key无效" }, request_id));
    return;
  }
  req.context = { ...(req.context || {}), userId: verified.user_id };
  next();
}

