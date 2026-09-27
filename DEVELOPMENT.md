# TrailHost 开发指南

本文档面向 TrailHost 的开发者和贡献者。安装、部署和日常使用说明见 [README.md](README.md)。

## 技术栈

| 组件 | 技术 |
| --- | --- |
| 后端 | Rust 1.94+、Axum、SQLx |
| 数据库 | PostgreSQL 16 |
| 浏览器扩展 | Preact、TypeScript、Vite、Manifest V3 |
| 端到端测试 | Playwright |
| 反向代理 | Caddy 2 |
| 部署 | Docker Compose |

## 项目结构

```text
backend/             Rust API、数据库迁移和集成测试
extension/           Chrome 扩展源码和单元测试
e2e/                 Playwright 端到端测试
.github/workflows/   按组件拆分的 CI 工作流
Caddyfile            生产环境反向代理配置
docker-compose.yml   生产环境服务编排
docker-compose.dev.yml
                     本地 PostgreSQL
```

## 本地开发

本地开发不需要 Caddy、域名或 HTTPS。PostgreSQL 在 Docker 中运行，后端和扩展在宿主机运行。

### 前置要求

- Rust 1.94+
- Node.js 22+
- Docker 和 Docker Compose

### 1. 启动 PostgreSQL

```bash
docker compose -f docker-compose.dev.yml up -d
```

开发数据库监听 `localhost:5432`，数据库和用户名均为 `trailhost`，密码为 `dev_password`。数据保存在 `postgres_dev_data` volume 中。

### 2. 配置并启动后端

在 `backend/` 目录创建仅供本地使用的 `.env`：

```env
DATABASE_URL=postgres://trailhost:dev_password@localhost:5432/trailhost
JWT_SECRET=local_development_secret_at_least_32_chars
BIND_ADDR=0.0.0.0:8080
RUST_LOG=info
```

然后启动后端：

```bash
cd backend
cargo run
```

后端监听 `http://localhost:8080`，启动时自动执行 `backend/migrations/` 中的数据库迁移。

### 3. 构建并加载扩展

新开一个终端：

```bash
cd extension
npm ci
npm run watch
```

将 `extension/dist/` 作为已解压扩展加载到 Chrome，并把服务器地址设置为 `http://localhost:8080`。每次重新构建后，在 `chrome://extensions` 中点击扩展的刷新按钮。

### 4. 停止开发数据库

```bash
docker compose -f docker-compose.dev.yml down
```

如需同时清除本地开发数据：

```bash
docker compose -f docker-compose.dev.yml down -v
```

## 环境变量

### 后端

| 变量 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | 无 | PostgreSQL 连接地址 |
| `JWT_SECRET` | 是 | 无 | JWT 签名密钥 |
| `TRAILHOST_USER_EMAIL` | 否 | 无 | 启动时创建或更新的普通用户邮箱；设置后关闭注册 |
| `TRAILHOST_USER_PASSWORD` | 否 | 无 | 预设用户密码；必须与 `TRAILHOST_USER_EMAIL` 同时设置 |
| `BIND_ADDR` | 否 | `0.0.0.0:8080` | 后端监听地址 |
| `RUST_LOG` | 否 | 无 | Rust 日志过滤级别；生产 Compose 设置为 `info` |

生产环境的 `DATABASE_URL` 由 `docker-compose.yml` 根据 `POSTGRES_PASSWORD` 生成。

后端同时收到 `TRAILHOST_USER_EMAIL` 和 `TRAILHOST_USER_PASSWORD` 时，会通过邮箱 upsert 普通用户并更新其 Argon2 密码哈希，然后将 `registration_enabled` 设为 false。此时 `POST /api/auth/register` 返回 `403 Forbidden`。只提供其中一个变量属于配置错误，后端会在监听端口前退出。

### Caddy

`docker-compose.yml` 将根目录 `.env` 中的 `DOMAIN` 和 `ACME_EMAIL` 注入 Caddy 容器。`Caddyfile` 使用 `{$DOMAIN}` 和 `{$ACME_EMAIL}` 做解析期替换。

`CADDY_HTTP_PORT` 和 `CADDY_HTTPS_PORT` 分别控制宿主机的 HTTP 和 HTTPS 端口映射，默认值为 80 和 443。HTTPS 的 TCP 与 HTTP/3 UDP 映射共用 `CADDY_HTTPS_PORT`；容器内端口固定为 80/443。

Caddy 将请求代理到 Docker 网络内的 `backend:8080`；WebSocket 升级由 Caddy 自动处理。配置还会添加 HSTS、`X-Content-Type-Options` 和 `X-Frame-Options` 响应头。

## 常用命令

### 后端

```bash
cd backend
cargo fmt --check
cargo test
```

后端集成测试使用 Testcontainers 启动 PostgreSQL，因此执行测试时需要可用的 Docker。

### 扩展

```bash
cd extension
npm ci
npm test
npm run build
```

### 端到端测试

先构建扩展，再安装并运行 Playwright 测试：

```bash
cd extension
npm ci
npm run build

cd ../e2e
npm ci
npx playwright install chromium
npm test
```

## API 参考

除健康检查、注册、登录和刷新令牌外，HTTP API 使用 `Authorization: Bearer <access-token>` 认证。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/auth/register` | 注册；配置预设用户时返回 `403 Forbidden` |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/refresh` | 刷新令牌 |
| `POST` | `/api/auth/logout` | 登出 |
| `POST` | `/api/history/batch` | 批量上传历史记录 |
| `GET` | `/api/history` | 查询历史记录，支持 `q`、`limit` 和 `offset` 参数 |
| `DELETE` | `/api/history/{id}` | 删除一条历史记录 |
| `WS` | `/api/ws?token=<token>` | 实时同步连接 |
