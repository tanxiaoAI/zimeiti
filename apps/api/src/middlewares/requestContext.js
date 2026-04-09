import { nanoid } from "nanoid";

export function requestContext(req, res, next) {
  const requestId = `req_${nanoid(10)}`;
  const start = Date.now();
  req.context = { ...(req.context || {}), requestId, start };

  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const ms = Date.now() - start;
    // 轻量日志：后续可替换为结构化日志系统
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        request_id: requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        latency_ms: ms
      })
    );
  });

  next();
}

