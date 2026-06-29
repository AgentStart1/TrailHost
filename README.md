# TrailHost

跨设备浏览器历史记录同步系统，包含 Rust 后端和浏览器插件。

## 功能

- 多设备实时同步浏览历史（WebSocket 推送）
- 自定义历史页面，替换浏览器默认历史页，支持搜索
- 多用户支持，注册/登录/JWT 认证
- 支持 Chrome / Firefox（Manifest V3）
- Docker 一键部署，Caddy 自动管理 HTTPS 证书

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Rust + Axum + SQLx |
| 数据库 | PostgreSQL 16 |
| 插件前端 | Preact + Vite + @crxjs/vite-plugin |
| 反向代理 | Caddy（自动 Let's Encrypt） |
| 部署 | Docker Compose |

## 目录结构

```
TrailHost/
├── backend/          # Rust API 服务
│   ├── src/
│   │   ├── auth/     # 注册、登录、JWT
│   │   ├── history/  # 历史记录上报与查询
│   │   └── ws/       # WebSocket 实时广播
│   └── migrations/   # 数据库迁移 SQL
├── extension/        # 浏览器插件
│   ├── src/
│   │   ├── api/          # 与后端通信的客户端
│   │   ├── background/   # Service Worker（监听、批量上报、WS）
│   │   ├── popup/        # 登录/注册弹窗
│   │   └── history-page/ # 自定义历史页
│   └── manifest.json
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## 本地开发与测试

本地测试无需域名和 HTTPS，后端直接运行在宿主机，数据库通过 Docker 启动。

### 前置要求

- [Rust](https://rustup.rs/)（stable）
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- Node.js 18+

### 1. 启动本地数据库

```bash
docker compose -f docker-compose.dev.yml up -d
```

这会在本机 `5432` 端口启动 PostgreSQL，账号为 `trailhost / dev_password`，数据持久化在 Docker volume `postgres_dev_data`。

### 2. 启动后端

```bash
cd backend
cp ../.env.dev .env    # 包含本地 DATABASE_URL 和 JWT_SECRET
cargo run
```

后端监听 `http://localhost:8080`，启动时自动执行数据库迁移。

若需要修改代码自动重启，可安装 `cargo-watch`：

```bash
cargo install cargo-watch
cargo watch -x run
```

### 3. 启动插件（watch 模式）

新开一个终端：

```bash
cd extension
npm install
npm run watch   # 修改代码后自动重新构建到 dist/
```

> 也可以使用 `npm run dev` 启动 Vite 开发服务器（支持 popup/历史页 HMR，
> 但 service worker 变更仍需手动在扩展管理页刷新插件）。

### 4. 加载插件到浏览器

1. 打开 `chrome://extensions`（Chrome）或 `about:debugging`（Firefox）
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `extension/dist/` 目录
4. 插件图标出现后，输入服务器地址 `http://localhost:8080`，注册并登录

之后每次 `npm run watch` 重新构建完成，在 `chrome://extensions` 点击插件的刷新按钮即可更新。

### 停止本地环境

```bash
docker compose -f docker-compose.dev.yml down
```

加 `-v` 同时清除数据库数据：

```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## 部署

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
POSTGRES_PASSWORD=your_strong_password
JWT_SECRET=your_random_secret_at_least_32_chars
```

### 2. 配置域名

编辑 `Caddyfile`，将 `your-domain.com` 替换为你的域名，并填写 Let's Encrypt 通知邮箱：

```
{
    email your@email.com
}

your-domain.com {
    reverse_proxy backend:8080
    ...
}
```

### 3. 启动服务

```bash
docker compose up -d --build
```

Caddy 会自动申请并续期 HTTPS 证书，无需额外操作。

## 安装插件

### 开发/自托管安装

1. 构建插件：

```bash
cd extension
npm install
npm run build
```

2. 打开浏览器扩展管理页面，启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `extension/dist/` 目录

### 首次使用

1. 点击浏览器工具栏中的 TrailHost 图标
2. 输入服务器地址（如 `https://your-domain.com`）
3. 注册账号或登录
4. 插件开始自动同步历史记录，访问 `chrome://history` 即可看到自定义历史页

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/refresh` | 刷新 token |
| POST | `/api/auth/logout` | 登出 |
| POST | `/api/history/batch` | 批量上报历史 |
| GET | `/api/history` | 查询历史（支持 `q` 搜索参数） |
| DELETE | `/api/history/:id` | 删除单条记录 |
| WS | `/api/ws?token=<token>` | 实时同步连接 |

