# TrailHost

TrailHost 是一个自托管的跨设备浏览器历史记录同步服务，由服务端和 Chrome 扩展组成。扩展会批量上传浏览记录，通过 WebSocket 接收实时同步通知，并提供可搜索的自定义历史页面。

## 功能

- 多设备同步浏览历史，支持实时通知
- 搜索和删除已同步的历史记录
- 自定义历史页面，替换 Chrome 默认历史页
- 多用户注册和登录
- 首次登录时同步最近 7 天、最多 500 条本地历史记录
- 待同步数量和同步状态角标
- Docker Compose 一键部署，自动申请和续期 HTTPS 证书

## 快速部署

### 前置要求

- 一台安装了 Docker 和 Docker Compose 的服务器
- 一个指向服务器公网 IP 的域名
- 公网可以访问服务器的 TCP 80 和 TCP 443 端口；开放 UDP 443 可启用 HTTP/3

### 1. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑项目根目录下的 `.env`：

```env
POSTGRES_PASSWORD=change_me_strong_password
JWT_SECRET=change_me_at_least_32_chars_random_string
DOMAIN=history.example.com
ACME_EMAIL=admin@example.com
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```

| 变量 | 用途 | 要求 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | 数据库密码 | 使用强随机密码；部署后不要随意修改 |
| `JWT_SECRET` | 登录令牌签名密钥 | 建议使用至少 32 字节的随机值；修改后现有登录会失效 |
| `DOMAIN` | TrailHost 的 HTTPS 域名 | 只填写主机名，例如 `history.example.com`，不要包含协议、路径或端口 |
| `ACME_EMAIL` | HTTPS 证书通知邮箱 | 填写有效邮箱地址 |
| `CADDY_HTTP_PORT` | Caddy 暴露到宿主机的 HTTP 端口 | 可选，默认 `80` |
| `CADDY_HTTPS_PORT` | Caddy 暴露到宿主机的 HTTPS 端口 | 可选，默认 `443`；TCP 和 UDP 使用同一端口 |

可以用 OpenSSL 生成随机密钥：

```bash
openssl rand -hex 32
```

Docker Compose 会读取根目录的 `.env`，再把 `DOMAIN` 和 `ACME_EMAIL` 传给 Caddy。仓库中的 `Caddyfile` 使用 `{$DOMAIN}` 和 `{$ACME_EMAIL}` 在解析配置前替换它们，因此常规部署不需要手动修改 `Caddyfile`。

`CADDY_HTTP_PORT` 和 `CADDY_HTTPS_PORT` 控制宿主机端口，容器内仍使用 Caddy 的标准 80/443 端口。例如服务器端口已被占用时，可以设置为 `8080` 和 `8443`。使用非标准端口时，访问地址需要包含端口；若仍需自动申请公网证书，还必须通过防火墙、路由器或负载均衡器把公网 80/443 转发到这些端口。

> `.env` 包含密码和密钥，不要提交到版本控制。若域名或邮箱发生变化，修改 `.env` 后运行 `docker compose up -d --force-recreate caddy` 即可应用配置。

### 2. 启动服务

确保域名的 DNS 记录已经生效，然后运行：

```bash
docker compose up -d --build
```

查看服务状态和 HTTPS 证书日志：

```bash
docker compose ps
docker compose logs -f caddy
```

Caddy 会自动申请并续期 HTTPS 证书。证书和 Caddy 状态保存在 Docker volumes 中，重建容器不会丢失。

部署完成后可检查服务是否正常：

```bash
curl https://history.example.com/api/health
```

成功时返回 HTTP `200 OK`。

### 3. 更新或停止

拉取最新代码后重新构建并启动：

```bash
docker compose up -d --build
```

停止服务但保留数据库和证书数据：

```bash
docker compose down
```

请谨慎使用 `docker compose down -v`，它会删除数据库以及 Caddy 的证书和状态。

## 安装浏览器扩展

### 构建

需要 Node.js 22 和 npm：

```bash
cd extension
npm ci
npm run build
```

构建产物位于 `extension/dist/`。

### 加载到 Chrome

1. 打开 `chrome://extensions`。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择 `extension/dist/`。
4. 点击 TrailHost 图标，填写服务器地址，例如 `https://history.example.com`。
5. 注册或登录账号。扩展会开始同步，访问 `chrome://history` 可打开 TrailHost 历史页面。

## 开发

本地环境搭建、项目结构、测试命令和 API 参考见 [DEVELOPMENT.md](DEVELOPMENT.md)。
