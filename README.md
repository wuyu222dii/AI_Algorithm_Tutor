# AlgoCoach / AI 算法教练

面向编程学习者的双语算法训练工具，覆盖教、练、测、评完整流程。访客可在浏览器 Worker 内运行 JavaScript、Python 和 TypeScript；登录后可将学习记录增量同步到 PostgreSQL。

## 本地开发

环境要求：Node.js 22.13+、pnpm 11.7.0；数据库集成测试和镜像验证需要 Docker。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发启动会读取 `.env.development.local`、`.env.local`、`.env.development` 和 `.env`，并在 `DB_AUTO_MIGRATE=true` 时自动执行 PostgreSQL 迁移。环境变量模板见 `.env.example`。

完整本地检查：

```bash
pnpm check
pnpm test:db:integration
pnpm test:e2e
docker build -t algocoach .
```

## Supabase

生产环境必须使用两个不同数据库角色：

- `MIGRATION_DATABASE_URL`：仅注入 release job，允许 DDL。
- `DATABASE_URL`：应用运行时连接，使用受限 DML 角色。

先在 Supabase SQL Editor 中用管理员权限创建应用角色，并为它设置独立强密码：

```sql
CREATE ROLE algocoach_app
  WITH LOGIN PASSWORD '<generate-a-new-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
```

release job 会验证该角色不是 schema owner 或高权限角色，执行迁移后只授予 `algocoach` schema 的 DML、序列使用权和迁移历史读取权。迁移不会在生产构建或容器启动阶段运行。

任何曾进入聊天、日志或提交历史的数据库密码都必须先在 Supabase 控制台轮换，再更新 GitHub Environment 和部署平台 Secret。

## Google 登录

分别创建开发和生产 Google Web OAuth Client：

- 开发 Origin：`http://localhost:3000`
- 开发 Redirect URI：`http://localhost:3000/api/auth/callback/google`
- 生产 Origin：生产 HTTPS Origin
- 生产 Redirect URI：`{AUTH_URL}/api/auth/callback/google`

OAuth consent screen 需要配置品牌、支持邮箱、隐私政策和服务条款。运行环境设置：

```dotenv
GOOGLE_AUTH_ENABLED=true
GOOGLE_ONE_TAP_ENABLED=false
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Client Secret 只能保存为部署 Secret，不得进入数据库公开配置、Git 仓库或 Docker build args。应用只提供标准 Google 按钮；经过 Google 验证的同邮箱账号自动合并，不同邮箱禁止链接，已有姓名、头像和学习数据不会被覆盖。

## AI 教练运行策略

服务端通过 `ALGO_COACH_MODEL` 和 `ALGO_COACH_FALLBACK_MODEL` 选择主备模型，客户端请求中的未知字段会被剥离，不能指定付费模型。需要按动作调优时，可配置 `ALGO_COACH_PARSE_MODEL`、`ALGO_COACH_DIAGNOSE_MODEL`、`ALGO_COACH_HINT_MODEL`、`ALGO_COACH_COUNTEREXAMPLE_MODEL`、`ALGO_COACH_REVIEW_CARD_MODEL`、`ALGO_COACH_CHAT_MODEL`，以及对应的 `*_FALLBACK_MODEL`。

模型在无可用通道、`429`、`5xx` 或超时时切换备用模型；结构化输出无效时只在原模型修复一次，连续瞬态故障会短时熔断。Redis 容量租约同时按用户或访客及可信代理 IP 限制并发、每日 token 和估算金额，默认每位学习者每日上限为 `US$0.05`。Chat 只会在首个内容块发送前切换模型，流开始后的故障单独记录为 `coach_chat_stream_failed`。生产环境不会在供应商失败时静默切换为确定性演示结果。

## 版本化题库

生产题库只从 PostgreSQL 的已发布 revision 读取。练习、运行结果、AI 反馈和本地自测均固定 `{slug, contentVersion}`，题目更新不会改变历史学习记录。必要配置：

```dotenv
DB_CATALOG_ENABLED=true
CATALOG_SYNC_ENABLED=false
TYPESCRIPT_ENABLED=true
EXERCISM_GITHUB_TOKEN=
```

`DB_CATALOG_ENABLED=false` 仅用于测试 fixture，生产 readiness 会拒绝该配置。`CATALOG_SYNC_ENABLED` 默认关闭，只在受限同步任务中临时设为 `true`。Exercism 同步只创建候选，不自动上线；当前首批 20 道题保留 MIT 许可证、署名、上游 commit、题面和 canonical-data 哈希。canonical UUID 只用于变更检测与审计，不会自动替换 AlgoCoach 已审核测试。

```bash
# 固定 fixture 验证，不访问上游
pnpm catalog:sync -- --fixture --workspace .catalog/review.json
pnpm catalog:validate -- --workspace .catalog/review.json
pnpm catalog:approve -- --workspace .catalog/review.json --reviewer reviewer@example.com --candidate <id>
pnpm catalog:publish -- --workspace .catalog/review.json --reviewer release-manager@example.com --candidate <id>

# 使用受限 DATABASE_URL 写入候选区；同步和校验受开关保护
CATALOG_SYNC_ENABLED=true pnpm catalog:sync
CATALOG_SYNC_ENABLED=true pnpm catalog:validate

# 数据库批准、发布与回滚必须明确提供各阶段人工身份和目标
pnpm catalog:approve -- --reviewer reviewer@example.com --candidate <id>
pnpm catalog:publish -- --reviewer release-manager@example.com --candidate <id>
pnpm catalog:rollback -- --reviewer reviewer@example.com --problem <slug> --revision <n>

# workspace 模式按不可变 release 回滚
pnpm catalog:rollback -- --workspace .catalog/review.json --reviewer reviewer@example.com --release <id>
```

每日 GitHub Workflow 使用 `CATALOG_DATABASE_URL` 写入并校验 PostgreSQL 候选区，同时生成独立的确定性 fixture artifact；它不会执行 approve 或 publish。候选在 `validated` 状态仍可人工检查和修订，之后必须由审核者显式 approve，再由发布者显式 publish。两个阶段分别写入审计记录，重复操作保持幂等，publish 仍会重新执行全部内容与来源校验。未知许可证、重复内容、危险 Markdown、无可靠 canonical 测试或不符合函数协议的题目会被拒绝；只有暂时无法解析、需要人工处理的候选会停留在 quarantine。

## 发布

GitHub Actions 在 PR 中运行格式、类型、零警告 Lint、单元测试、离线 AI 评测、编辑器资源预算、PostgreSQL 集成、生产构建、Playwright 和 Docker 冒烟测试。

手动发布前，在 `staging` 和 `production` GitHub Environment 配置：

- Secret：`MIGRATION_DATABASE_URL`
- 题库同步 Secret：`CATALOG_DATABASE_URL`（仅授予候选区所需写权限）
- Variable：`DATABASE_APPLICATION_ROLE=algocoach_app`
- 应用部署 Secret：`DATABASE_URL`、`AUTH_SECRET`、Google、OpenRouter、Redis 和可选遥测配置

先从 Actions 手动选择 `staging`，完成一次真实 Google 测试账号验收；生产发布只允许从 `main` 发起。release job 成功后才会发布带 SBOM 和 provenance 的不可变 GHCR 镜像。

运行探针：

- `GET /api/health/live`：进程存活
- `GET /api/health/ready`：检查配置、认证、AI 模式、Redis 连通性、受限数据库角色、迁移版本和已发布题库；生产环境任一必需项异常均返回 `503`

生产环境必须配置 HTTP REST 形式的 `REDIS_URL` 与 `REDIS_TOKEN`，readiness 会执行无副作用的 `PING`。开发环境未配置 Redis 时继续使用进程内限流，不影响本地启动。AI readiness 只校验模型、Base URL 和凭据配置，不会请求模型供应商，避免供应商短时故障触发实例重启循环。

## License

See [LICENSE](./LICENSE). Do not redistribute the underlying licensed template code unless the license permits it.
