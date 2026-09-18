# 非遗与文旅智能咨询系统

本仓库实现一个围绕自托管 Dify 的业务平台，覆盖知识库运营、文档索引过程可视化、跨端咨询和后续用户/积分/支付能力。

## 当前实现

- NestJS API：
  - Dify Knowledge Service API 客户端
  - 知识库创建、更新、删除和模型查询
  - 文件/文本上传、元数据发布字段维护
  - BullMQ 索引轮询、状态机、重试和事件记录
  - SSE 索引进度
  - 文档分段查询与编辑
  - 召回测试
  - 多知识库检索、引用合并和 Dify Chatflow 流式回答
  - 会话和消息持久化
- 管理员后台：
  - 五步知识库创建向导
  - 索引、分段和检索细粒度配置
  - 文档上传、实时索引进度
  - 文档审核发布、分段查看和召回测试
- PC 用户端：
  - PC 与移动浏览器响应式咨询界面
  - 多知识库选择
  - SSE 流式回答和来源引用
- Taro 小程序：
  - 微信小程序基础咨询页面
  - 调用非流式问答接口
- 部署：
  - 独立 PostgreSQL/Redis Docker 服务
  - API、Worker、Admin、Web Dockerfile
  - Nginx 域名配置模板
  - Dify Chatflow DSL

## 重要说明

本机不需要预装 PostgreSQL。`docker-compose.app.yml` 会启动独立的 `app-postgres` 容器并创建持久化卷。

管理员 API 使用服务端账号登录和数据库会话保护，支持 `SUPER_ADMIN`、`KB_ADMIN` 与普通 `USER` 角色基础结构。普通用户手机号/微信登录、积分账本和微信支付将在下一阶段接入；当前代码已经将 API 边界和共享类型拆开，便于继续实现。

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 PostgreSQL 和 Redis

```bash
docker compose --env-file .env -f docker-compose.app.yml up -d app-postgres app-redis
```

如果 Docker 当前不可用，可先只执行类型检查和构建，数据库联调需要等服务启动后再进行。

### 3. 配置环境变量

```bash
copy .env.example .env
```

至少填写：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-long-random-password
APP_POSTGRES_PASSWORD=replace-with-a-database-password
DIFY_API_BASE_URL=http://localhost/v1
DIFY_KNOWLEDGE_API_KEY=dataset-xxxxxxxx
DIFY_CHAT_APP_API_KEY=app-xxxxxxxx
NEXT_PUBLIC_API_BASE_URL=http://localhost:3100/api
```

生产环境与 Dify 在同一 Docker 网络时，将 Dify 地址改为容器内部入口：

```dotenv
DIFY_API_BASE_URL=http://nginx/v1
DIFY_DOCKER_NETWORK=docker_default
```

### 4. 启动服务

```bash
pnpm dev:api
pnpm dev:worker
pnpm dev:admin
pnpm dev:web
pnpm dev:mobile
```

访问：

- 管理员后台：<http://localhost:3200>
- PC 咨询：<http://localhost:3300>
- API 健康检查：<http://localhost:3100/api/health>

小程序开发依赖使用 Taro 官方 Vite 编译器，已避免引入 Webpack/Babel 的完整工具链。

## Dify 配置

按照 [dify/README.md](dify/README.md) 导入 Chatflow 并创建两个 API Key。

## 验证

```bash
pnpm typecheck
pnpm build
```

端到端验收流程：

1. 管理员创建知识库并上传文档。
2. 在后台看到等待、解析、清洗、分段、索引和待审核状态。
3. 查看真实分段并执行召回测试。
4. 将文档发布。
5. 在 PC、移动 H5 或小程序中选择该知识库提问。
6. 回答包含引用，并在数据库中保存会话与消息。
