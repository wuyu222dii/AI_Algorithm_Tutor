# AlgoCoach / AI 算法教练

面向编程学习者的双语算法训练工具，覆盖教、练、测、评完整流程。访客可在浏览器内运行 JavaScript/Python；登录后可将学习记录增量同步到 PostgreSQL。

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

## 发布

GitHub Actions 在 PR 中运行格式、类型、零警告 Lint、单元测试、离线 AI 评测、编辑器资源预算、PostgreSQL 集成、生产构建、Playwright 和 Docker 冒烟测试。

手动发布前，在 `staging` 和 `production` GitHub Environment 配置：

- Secret：`MIGRATION_DATABASE_URL`
- Variable：`DATABASE_APPLICATION_ROLE=algocoach_app`
- 应用部署 Secret：`DATABASE_URL`、`AUTH_SECRET`、Google、OpenRouter、Redis 和可选遥测配置

先从 Actions 手动选择 `staging`，完成一次真实 Google 测试账号验收；生产发布只允许从 `main` 发起。release job 成功后才会发布带 SBOM 和 provenance 的不可变 GHCR 镜像。

运行探针：

- `GET /api/health/live`：进程存活
- `GET /api/health/ready`：配置、受限数据库角色和迁移版本就绪

## License

See [LICENSE](./LICENSE). Do not redistribute the underlying licensed template code unless the license permits it.
