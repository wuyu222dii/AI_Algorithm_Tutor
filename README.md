# AlgoCoach / AI 算法教练

面向编程学习者的双语算法训练工具，覆盖教、练、测、评完整流程。访客可在浏览器 Worker 内运行 JavaScript、Python 和 TypeScript；登录后可将学习记录增量同步到 PostgreSQL。

## 本地开发

环境要求：Node.js 22.13+、pnpm 11.7.0；数据库集成测试和镜像验证需要 Docker。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发启动会读取 `.env.development.local`、`.env.local`、`.env.development` 和 `.env`。数据库迁移默认关闭；需要迁移时，在未提交的本地环境文件中配置独立的 `MIGRATION_DATABASE_URL` 后执行 `pnpm db:migrate`。也可以显式设置 `DB_AUTO_MIGRATE=true`，让开发启动先迁移再启动 Next.js。迁移脚本不会回退使用 `DATABASE_URL`。环境变量模板见 `.env.example`。

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

本地开发也遵守相同边界：迁移连接和运行连接分别保存到 `.env.development.local`，不要提交到 Git，也不要把同一个高权限账号同时填入两个变量。`DB_AUTO_MIGRATE=true` 但缺少 `MIGRATION_DATABASE_URL` 时，启动会直接失败并说明缺少专用迁移连接；`DB_AUTO_MIGRATE=false` 时启动不会修改数据库结构。

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

AlgoCoach 只连接自定义 OpenAI-compatible 中转站，不调用 OpenAI 官方 API。`OpenAI-compatible` 仅表示 `/v1/chat/completions` 协议兼容。服务端使用以下配置，模型 ID 必须与中转站 `/v1/models` 返回值完全一致：

```dotenv
AI_RELAY_BASE_URL=https://codeapix.top/v1
AI_RELAY_API_KEY=...
AI_RELAY_PRIMARY_MODEL=...
AI_RELAY_FALLBACK_MODEL=...
AI_RELAY_STRUCTURED_OUTPUT_MODE=json
AI_RELAY_CANARY_TOKEN=...
AI_RELAY_PRICING_JSON='{"relay-model-id":{"inputPerMillionUsd":3,"outputPerMillionUsd":15}}'
```

先运行 `pnpm ai:preflight` 验证模型列表、普通生成、流式生成和结构化 JSON。命令只输出 Origin、模型、能力与错误分类，不输出 Key、题面或代码。`OPENROUTER_*` 和原全局模型变量仅保留一个版本兼容并输出弃用警告；新的部署 Secret 必须使用 `AI_RELAY_*`。客户端请求中的未知字段会被剥离，不能指定模型。

若配置动作级 `ALGO_COACH_<ACTION>_MODEL`，生产值只能选择上述已预检的主模型或备用模型。`AI_RELAY_STRUCTURED_OUTPUT_MODE=json-schema` 只有在两个模型都通过 JSON Schema 预检时才允许发布；否则使用 `json`，由服务端执行严格结构校验与一次修复。

主模型在分组拒绝、无可用渠道、`429`、`5xx` 或超时时仅切换一次已预检的备用模型；`401` 立即失败。结构化输出无效时只在原模型修复一次，连续 3 次瞬态故障通过 Redis 熔断 60 秒。Redis 容量租约同时按用户或访客及可信代理 IP 限制并发、每日 token 和估算金额，默认每位学习者每日上限为 `US$0.05`。中转站缺失 usage 时保留请求前的最大成本预留，实际价格只读取 `AI_RELAY_PRICING_JSON`。Chat 只会在首个内容块发送前切换模型，流开始后的故障单独记录。生产环境不会在中转站失败时静默切换为确定性演示结果。

## 版本化题库

生产题库只从 PostgreSQL 的已发布 revision 读取。练习、运行结果、AI 反馈和本地自测均固定 `{slug, contentVersion}`，题目更新不会改变历史学习记录。必要配置：

```dotenv
DB_CATALOG_ENABLED=true
CATALOG_SYNC_ENABLED=false
CATALOG_ADMIN_DATABASE_URL=
CATALOG_STRUCTURED_REVIEW_MODE=shadow
CATALOG_BOOTSTRAP_ENABLED=false
CATALOG_DISCOVERY_ENABLED=false
CATALOG_DISCOVERY_MAX_EXERCISES=20
CATALOG_ANOMALY_DELTA_THRESHOLD=25
CATALOG_DISCOVERY_INGEST_ENABLED=false
CATALOG_AI_DRAFT_ENABLED=false
CATALOG_AI_MODEL=<same-as-AI_RELAY_PRIMARY_MODEL>
TYPESCRIPT_ENABLED=true
EXERCISM_GITHUB_TOKEN=
```

`DB_CATALOG_ENABLED=false` 仅用于测试 fixture，生产 readiness 会拒绝该配置。`CATALOG_STRUCTURED_REVIEW_MODE` 在生产默认采用 `shadow`，完成只读投影核对后再切换为 `write`；任何模式都不会让定时同步自动批准或发布候选。`CATALOG_SYNC_ENABLED` 默认关闭，只在受限同步任务中临时设为 `true`。Exercism 同步只创建候选，不自动上线；当前首批 20 道题保留完整 MIT LICENSE 原文、许可证/题面/canonical-data Git blob SHA、内容 SHA-256、署名和固定上游 commit。bootstrap 会保存同一组 blob 基线，紧接着的 discovery 不会把未变化的 20 道题误报为新候选。canonical UUID 只用于变更检测与审计，不会自动替换 AlgoCoach 已审核测试。

迁移会创建 `algocoach_catalog_sync`、`algocoach_catalog_reviewer` 和 `algocoach_catalog_publisher` 三个 `NOLOGIN` 能力角色。Supabase 中只需一次性创建两个独立登录账号，密码必须使用新生成的 Secret：

```sql
CREATE ROLE algocoach_catalog_worker LOGIN PASSWORD '<new-sync-password>';
GRANT algocoach_catalog_sync TO algocoach_catalog_worker;

CREATE ROLE algocoach_catalog_admin LOGIN NOINHERIT PASSWORD '<new-admin-password>';
GRANT algocoach_catalog_reviewer, algocoach_catalog_publisher
  TO algocoach_catalog_admin;
```

worker 连接串保存为 GitHub Environment Secret `CATALOG_DATABASE_URL`；admin 连接串仅保存为应用服务端 Secret `CATALOG_ADMIN_DATABASE_URL`。后台每次操作都会 `SET LOCAL ROLE` 到当前阶段，且候选记录要求批准者与发布者是两个不同的登录用户。不要让应用 `DATABASE_URL`、同步账号或浏览器获得发布权限。

`CATALOG_DATABASE_URL` 的 Secret 值只能是裸 PostgreSQL URL，不要包含 `CATALOG_DATABASE_URL=`、`export`、引号、反引号或 `<PASSWORD>` 占位符；密码中的 `#`、`/`、`?` 等保留字符必须进行 URL 编码。Workflow 会先运行 `pnpm catalog:db:preflight`，以不输出连接串的方式验证 URL、登录身份、同步角色成员关系和最小表权限。

Git Tree discovery 在解析 `main` 得到完整 commit SHA 后，所有 tree、LICENSE、题面和 canonical-data 请求都固定到该 SHA。单次请求限制 10 秒，LICENSE 限制 64 KiB，题面限制 256 KiB，canonical-data 限制 2 MiB 且 JSON 深度不超过 32；候选完整保留 LICENSE 原文、Git blob SHA、内容 SHA-256、原始题面与 canonical-data，供人工审核和构建测试。发现结果始终是 `publishable: false` 的结构化草稿；开启 `CATALOG_AI_DRAFT_ENABLED` 后，`CATALOG_AI_MODEL` 只能选择已通过中转站预检且已配置实际价格的主模型或备用模型，并且只能建议双语标题、描述、难度、知识点、学习目标和单函数签名。JavaScript、Python、TypeScript starter template 由本地代码根据签名确定性生成，只含 TODO、`pass` 或 `throw` 占位；解法、Hint 与权威测试仍为空。草稿入库后保持 quarantine，不能直接发布。定时任务优先处理已发布题的上游变化，再发现普通新题；待审核候选达到 50 时暂停普通新题摄取，未变化题不占批次上限，每批最多 10 道。这个数字只表示进入候选审核区的批次上限，不表示题目会自动发布。

```bash
# 固定 fixture 验证，不访问上游
pnpm catalog:sync -- --fixture --workspace .catalog/review.json
pnpm catalog:validate -- --workspace .catalog/review.json
pnpm catalog:approve -- --workspace .catalog/review.json --reviewer reviewer@example.com --candidate <id>
pnpm catalog:publish -- --workspace .catalog/review.json --reviewer release-manager@example.com --candidate <id>

# 使用受限 DATABASE_URL 写入候选区；同步和校验受开关保护
CATALOG_SYNC_ENABLED=true pnpm catalog:sync
CATALOG_SYNC_ENABLED=true pnpm catalog:validate
CATALOG_SYNC_ENABLED=true pnpm catalog:monitor

# 只生成未收录题目的安全 review artifact
CATALOG_DISCOVERY_ENABLED=true pnpm catalog:discover -- --output .catalog/discovery.json

# 使用受限 writer 将同一 artifact 入库为 quarantine，并再次执行校验
CATALOG_DISCOVERY_ENABLED=true CATALOG_DISCOVERY_INGEST_ENABLED=true \
  pnpm catalog:discover -- --output .catalog/discovery.json --ingest --reviewer operator@example.com
CATALOG_SYNC_ENABLED=true pnpm catalog:validate

# 首次启用定时同步前只执行一次：建立已发布 20 题的上游基线，
# 不创建 candidate、revision 或测试。完成后立即关闭开关。
CATALOG_BOOTSTRAP_ENABLED=true pnpm catalog:bootstrap -- --reviewer operator@example.com

# 数据库批准、发布与回滚必须明确提供各阶段人工身份和目标
pnpm catalog:approve -- --reviewer <better-auth-reviewer-user-id> --candidate <id>
pnpm catalog:publish -- --reviewer <different-publisher-user-id> --candidate <id>
pnpm catalog:rollback -- --reviewer <publisher-user-id> --problem <slug> --revision <n>

# 数据库模式的 reviewer 参数必须是现有 Better Auth user.id；批准者与发布者必须不同。

# workspace 模式按不可变 release 回滚
pnpm catalog:rollback -- --workspace .catalog/review.json --reviewer reviewer@example.com --release <id>
```

每日 GitHub Workflow 绑定 `catalog-sync-production` Environment，使用 `CATALOG_DATABASE_URL` 写入并校验 PostgreSQL 候选区，同时生成真实 Git Tree discovery review artifact 和独立的确定性 fixture artifact；它不会执行 approve 或 publish。首次配置 Environment 后，通过 `workflow_dispatch` 的 `bootstrap=true` 只建立一次性基线，发现与摄取 Job 会跳过；后续使用定时任务或 `bootstrap=false` 执行日常同步。候选在 `validated` 状态仍可人工检查和修订，之后必须由审核者显式 approve，再由发布者显式 publish。两个阶段分别写入审计记录，重复操作保持幂等，publish 仍会重新执行全部内容与来源校验。未知许可证、重复内容、危险 Markdown、无可靠 canonical 测试或不符合函数协议的题目会被拒绝；只有暂时无法解析、需要人工处理的候选会停留在 quarantine。

独立 anomaly monitor 会在连续两次同步失败、MIT SPDX/许可证哈希变化，或单次候选数/上游题目树变化超过 `CATALOG_ANOMALY_DELTA_THRESHOLD` 时写入 GitHub Job Summary、输出 `::error` 并使监控任务失败。该监控只读取同步历史，不会修改已发布题库。

## 发布

GitHub Actions 在 PR 中运行格式、类型、零警告 Lint、单元测试、离线 AI 评测、编辑器资源预算、PostgreSQL 集成、生产构建、Playwright 和 Docker 冒烟测试。

手动发布前，在 `staging` 和 `production` GitHub Environment 配置：

- Secret：`MIGRATION_DATABASE_URL`
- `catalog-sync-production` Environment Secret：`CATALOG_DATABASE_URL`（仅授予 source、sync run、candidate 和 audit 所需权限）
- Variable：`DATABASE_APPLICATION_ROLE=algocoach_app`
- 应用部署 Secret：`DATABASE_URL`、`CATALOG_ADMIN_DATABASE_URL`、`AUTH_SECRET`、Google、`AI_RELAY_API_KEY`、Redis 和可选遥测配置

先从 Actions 手动选择 `staging`，完成一次真实 Google 测试账号验收；生产发布只允许从 `main` 发起。release job 成功后才会发布带 SBOM 和 provenance 的不可变 GHCR 镜像。

发布迁移必须遵循 expand/contract：release job 只应用向后兼容的新增表、列、索引或约束准备，删除或改变旧字段语义必须延后到旧镜像全部退出之后。Readiness 会拒绝缺失或乱序迁移，但允许数据库在保持当前历史前缀完整时暂时领先镜像，因此 AI Gate 失败不会把已包含此前缀兼容逻辑的旧版本置为不可用。

首次从不支持“数据库版本领先”的旧镜像升级到本版本时，需要先部署一个包含新 readiness 逻辑但仍以旧迁移为期望值的 bridge 镜像；确认 bridge 健康后再运行 release migration，最后部署正式镜像。如果当前平台无法分三步发布，则在维护窗口内先完成中转站 Gate，再迁移数据库并立即切换正式镜像。后续版本只要继续使用向后兼容迁移，即可恢复正常的“迁移 Job 与 AI Gate 并行、Gate 通过后发布镜像”流程。

运行探针：

- `GET /api/health/live`：进程存活
- `GET /api/health/ready`：检查配置、认证、AI 模式、Redis 连通性、受限数据库角色、迁移版本和已发布题库；生产环境任一必需项异常均返回 `503`
- `POST /api/health/ai-relay`：使用 `Authorization: Bearer $AI_RELAY_CANARY_TOKEN` 执行受保护的低成本中转站探测

生产环境必须配置 HTTPS REST 形式的 `REDIS_URL` 与 `REDIS_TOKEN`，readiness 会执行无副作用的 `PING`；远程明文 HTTP 会被拒绝，`REDIS_ALLOW_INSECURE_LOCAL=true` 仅供 Docker smoke 连接本机 mock。开发环境未配置 Redis 时继续使用进程内限流，不影响本地启动。AI readiness 只校验模型、Base URL 和凭据配置；真实中转站连通性由受保护 canary 与发布 AI Gate 检查，避免中转站短时故障触发实例重启循环。

## License

See [LICENSE](./LICENSE). Do not redistribute the underlying licensed template code unless the license permits it.
