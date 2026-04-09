# AI辅助自媒体工具（小红书优先）- MVP 工程骨架

本仓库是基于 PRD 的**可运行最小实现**，核心目标：在 **Mock 模式**下跑通端到端链路，并支持后续一键切换到你提供的真实 API（HTTP REST + API Key）。

## 运行方式（本地）
1) 安装依赖
```bash
npm install
```

2) 启动 API（默认端口 8787）
```bash
npm run dev:api
```

启动后访问：
- `GET http://localhost:8787/health`

3) （可选）启动占位前端（默认端口 3000）
```bash
npm run dev:web
```
访问：
- `http://localhost:3000`

## 关键环境变量
API 服务支持按能力单独切换 Mock/Real（当前默认全部 mock）：
- `CAP_HOT=mock|real`
- `CAP_LLM=mock|real`
- `CAP_COVER=mock|real`
- `CAP_RAG=mock|real`
- `CAP_ANALYTICS=mock|real`

鉴权：
- 登录成功后会返回 `api_key`，后续请求需携带请求头：`X-API-Key: <api_key>`

## 快速体验（curl）
1) 登录获取 API Key
```bash
curl -s -X POST http://localhost:8787/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"invite_code":"DEMO","passcode":"123456"}'
```

2) 创建项目
```bash
curl -s -X POST http://localhost:8787/api/v1/projects \
  -H 'content-type: application/json' \
  -H 'X-API-Key: <替换为上一步返回的api_key>' \
  -d '{"name":"我的小红书账号","platform":"xiaohongshu"}'
```

## 代码入口
- API：`apps/api/src/server.js`
- Mock 数据：`packages/mock-data/*`
- 共享契约：`packages/shared/*`
