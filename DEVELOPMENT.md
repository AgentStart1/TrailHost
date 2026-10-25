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

### 依赖更新

Dependabot 配置位于 `.github/dependabot.yml`。根目录的 Compose 镜像使用 `docker-compose` 生态，`backend/Dockerfile` 使用 `docker` 生态；两者需要分别配置。

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

#### 文件内并行评估（上游 issue #19）

2026-10-25 在 Windows 11、Node.js 26.8.1、Playwright 1.64.1 / Chromium 1248、
28 个逻辑 CPU、31.8 GiB 内存的本地环境评估了 `auth-page.spec.ts` 的 6 个用例。
复测后仍未启用 `fullyParallel`，保留 Playwright 默认的跨文件并行；结果不能直接外推到 Ubuntu CI。

隔离检查：fixture 为 test scope，`launchPersistentContext("")` 每次创建独立临时
profile；`chrome.storage.local` 随 profile 隔离，路由注册在各自 page/context 上，
录像位于各例的 `testInfo.outputDir/videos`。两个并行故意失败探针分别写入并读取不同的
storage 和路由响应，检查均通过；各自产出独立的非空录像、可读取的 `trace.zip`
和错误报告。初次评估发现录像没有作为报告附件关联，两个探针还出现 context 收尾超时。
已修复录像关联：fixture 在 `finally` 中关闭 context，随后用 `testInfo.attach` 附加失败录像；
成功用例在关闭后删除本地文件。persistent context 关闭也会断开浏览器连接，不能在其后
调用依赖浏览器连接的 `video.delete()`。录像处理失败现在会使测试失败，不再被静默忽略。
本地和 CI 均生成 `playwright-report/` HTML 报告，CI 失败时上传报告及 fixture 验收产物。

旧的收尾超时尚未确定根因：修改前加阶段日志的 144 例均通过，无法重现旧异常，
不能把本次录像修复宣称为超时的确定性修复。此次复测不增加超时或重试。
修改后另做 30 例带 trace 的重复验收，10 个成功、20 个预设失败，均未出现额外收尾错误。
最终完整 E2E 13/13 通过，HTML 报告中的六个失败录像副本也均由 Chromium 成功解码。
配置中的 `on-first-retry` 在关闭重试的基准中不会生成 trace；探针单独使用 `trace: "on"`，
不计入性能数据。

对照使用相同扩展构建、`CI=true`（启用扩展可用的 headless 参数）、固定 worker 上限 2、
`--retries=0`，每次独立启动 runner，按串行、并行、并行、串行、串行、并行的顺序执行。
串行保持默认同文件顺序执行，实际使用 1 worker；并行增加 `--fully-parallel`，实际使用 2 workers。
耗时为完整命令的墙钟时间，内存为每 50 ms 采样 runner 及后代进程 RSS 总和的峰值
（含浏览器与录像进程，共享内存可能重复计数，不等于系统实际新增内存）。

| 轮次 | 模式 | 耗时（秒） | 峰值 RSS（MiB） | 结果 |
| --- | --- | ---: | ---: | --- |
| 1 | 文件内串行 | 4.416 | 966.7 | 6/6 通过 |
| 2 | 文件内并行 | 2.780 | 1576.7 | 6/6 通过 |
| 3 | 文件内并行 | 2.885 | 1737.5 | 6/6 通过 |
| 4 | 文件内串行 | 4.391 | 985.6 | 6/6 通过 |
| 5 | 文件内串行 | 4.251 | 971.6 | 6/6 通过 |
| 6 | 文件内并行 | 2.676 | 1705.2 | 6/6 通过 |

单文件耗时中位数从 4.391 秒降为 2.780 秒（约快 37%），峰值 RSS 中位数从
971.6 MiB 增至 1705.2 MiB（约增加 75%）。隔离和产物检查通过后，进一步使用相同
2-worker 上限、相同轮次顺序对完整 13 例套件进行对照：

| 轮次 | 模式 | 耗时（秒） | 峰值 RSS（MiB） | 结果 |
| --- | --- | ---: | ---: | --- |
| 1 | 默认跨文件并行 | 6.082 | 1778.8 | 13/13 通过 |
| 2 | fullyParallel | 5.633 | 1672.4 | 13/13 通过 |
| 3 | fullyParallel | 5.702 | 1766.1 | 13/13 通过 |
| 4 | 默认跨文件并行 | 5.875 | 1748.5 | 13/13 通过 |
| 5 | 默认跨文件并行 | 5.970 | 1699.7 | 13/13 通过 |
| 6 | fullyParallel | 6.125 | 1702.1 | 13/13 通过 |

完整套件耗时中位数为 5.970 / 5.702 秒，仅改善约 4.5%（0.268 秒），且并行与默认
模式的耗时范围重叠；峰值 RSS 中位数为 1748.5 / 1702.1 MiB。结论：单文件有收益，
完整套件的额外收益较小，当前不更改默认调度。在 Ubuntu CI 中重复测量并定位旧收尾
异常后再决定是否启用；不能用旧的超时轮次作为加速基线，亦不能将本次环境整体变快归因于代码修复。

复测命令（在 `e2e/` 下，先按上文构建扩展并安装依赖和浏览器；PowerShell 用
`$env:CI="true"` 设置环境变量）：

```bash
npx playwright test auth-page.spec.ts --workers=2 --retries=0 --reporter=json --output=test-results/serial
npx playwright test auth-page.spec.ts --workers=2 --fully-parallel --retries=0 --reporter=json --output=test-results/parallel
```

录像生命周期回归验证（CI 也执行）：

```bash
npm run test:fixtures
```

该命令分别启动串行和 2-worker 并行子 runner，故意让两个探针失败，外层验证器确认
只有预期错误、三页录像均成为独立附件（含中途关闭页）、trace 和 HTML 录像副本存在，
以及成功用例不保留录像。子 runner 的故意失败不代表外层验证失败；最终命令应退出 0。
产物位于 `e2e/test-results/fixture-contract/`。整个评估没有改动后端数据库初始化锁。
自定义 `PLAYWRIGHT_BROWSERS_PATH` 时应放在测试输出目录之外；Playwright 每次运行会清理
自己的 outputDir，默认是 `test-results/`，不能把浏览器缓存存放在其中。
如需工作区内缓存，可在 `e2e/` 下用 PowerShell 设置
`$env:PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers"`，再运行
`npx playwright install chromium`；该目录已被 Git 忽略。

Ubuntu 诊断工作流位于 `.github/workflows/e2e-assessment.yml`，独立验证分支
`codex/e2e-investigation` 的 push 会触发，也支持 `workflow_dispatch`。
它先验证完整套件，再分别进行 60 例串行和并行诊断，以及五轮失败产物验收。
`E2E_DIAGNOSTICS=1` 会在各例 outputDir 中记录 `lifecycle.jsonl`：浏览器启动、
context 关闭、录像路径获取、删除和附加的开始/完成/错误及耗时，不记录 URL 或 storage 内容。
最后一条没有完成事件的阶段用于定位阻塞，不能仅凭通用的 fixture timeout 判断根因。

性能对照通过 `python3 scripts/assess_parallel.py` 在 Linux 的 `e2e/` 下运行。
它分别对单文件和完整套件预热两种调度方式，再交替各测五轮；固定 2 workers、零重试、
关闭诊断日志，并以 100 ms 间隔采集 `/proc` 中完整子进程树的 RSS。峰值可能低估采样间隔内
的瞬时值，共享页可能重复计数。原始 JSON、环境、内存指标和 Markdown 汇总保存在
`test-results/parallel-assessment/`，CI 将其与诊断日志和报告一起上传。

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
