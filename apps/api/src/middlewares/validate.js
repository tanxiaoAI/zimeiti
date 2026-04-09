import { ErrorCodes } from "@ai-media/shared/errors";
import { fail } from "@ai-media/shared/contracts";

export function validateBody(schema) {
  return (req, res, next) => {
    const request_id = req.context?.requestId;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(
        fail(
          {
            code: ErrorCodes.VALIDATION_FAILED,
            message: "参数校验失败",
            details: parsed.error.flatten()
          },
          request_id
        )
      );
      return;
    }
    req.validated = { ...(req.validated || {}), body: parsed.data };
    next();
  };
}

