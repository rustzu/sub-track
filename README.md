# SubTrack

基于 [Cloudflare Workers](https://developers.cloudflare.com/workers/) 的订阅到期提醒应用：单文件 Worker（`worker.js`）提供登录、管理后台、REST API、多渠道通知与定时巡检。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rustzu/sub-track)

> 一键部署会拉取本仓库代码并引导你登录 Cloudflare、创建/选择 KV 命名空间。部署完成后请按下方说明配置 **Cron 定时触发器**，并在后台修改默认管理员密码。

## 功能概览

- **SubTrack**：名称、到期日、公历/农历、周期与自动续订、提醒规则、标签、启用状态等。
- **管理界面**：Tailwind 样式内嵌于 Worker，无需单独静态站点托管。
- **认证**：管理员用户名/密码登录，HTTP-only Cookie 存放 JWT。
- **通知渠道**（可在后台勾选启用）：NotifyX、Telegram、Webhook、企业微信机器人、邮件（Resend）、Bark 等；支持按配置合并发送。
- **定时任务**：`scheduled` 触发器按配置时区与 `NOTIFICATION_HOURS` 检查即将到期或已过期订阅，并发送汇总提醒；支持自动续订推算后写回 KV。
- **第三方推送 API**：`POST /api/notify/{token}`（令牌也可通过 `Authorization: Bearer` 或查询参数 `token` 传入），将自定义标题与正文走同一套通知渠道。

## 技术栈

| 部分   | 说明                                                                                          |
| ------ | --------------------------------------------------------------------------------------------- |
| 运行时 | Cloudflare Workers（`compatibility_date` 见 `wrangler.toml`）                                 |
| 数据   | Cloudflare KV，绑定名 `SUB_TRACK_KV`（存 `config` 与 `subscriptions`）                    |
| 样式   | Tailwind CSS v3，`npm run build` 生成压缩 CSS 并写入 `worker.js` 中的 `EMBEDDED_TAILWIND_CSS` |

## 前置要求

- [Node.js](https://nodejs.org/)（建议当前 LTS）
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)（可通过 `npx wrangler` 使用）
- Cloudflare 账号，并已创建用于本项目的 **KV 命名空间**

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发

```bash
npm run dev
# 或
npx wrangler dev
```

本地预览默认账号：`admin` / `password`。若本地也要读写 KV，需先完成下文「方式 B：Wrangler 命令行部署」中的 KV 配置（`wrangler.toml` 填写真实命名空间 ID）。

### 3. 构建样式（仅在你修改了 Tailwind 时）

仓库中的 `worker.js` 已内置压缩后的 CSS，**直接部署通常无需构建**。只有改过 `tailwind.input.css` 或升级 Tailwind 时才执行：

```bash
npm run build
```

该命令依次执行：`build:css`（输出 `dist/app.css`）→ `build:embed`（把 CSS 写回 `worker.js`）。

---

## 部署

### 方式 A：一键部署（推荐）

点击文首 **[Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/?url=https://github.com/rustzu/sub-track)** 按钮，按向导完成：

1. 使用 GitHub 授权并选择要部署的分支（一般为 `main`）。
2. 登录 Cloudflare 并选择账号。
3. 在 **KV namespace bindings** 步骤中，为变量名 `SUB_TRACK_KV` **新建或选择** 一个 KV 命名空间（绑定名必须与代码一致，见 `wrangler.toml`）。
4. 确认部署；记下分配的 `*.workers.dev` 域名。

部署后请到 [Workers 控制台](https://dash.cloudflare.com/) → 该 Worker → **Triggers → Cron Triggers** 添加定时任务（见下文「定时任务」），并在 `/admin/config` 修改默认密码。

### 方式 B：Wrangler 命令行部署

#### B1. 创建 KV 并写入配置

```bash
# 登录（首次）
npx wrangler login

# 创建生产环境 KV 命名空间（记下返回的 id）
npx wrangler kv namespace create SUB_TRACK_KV
```

将返回的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "SUB_TRACK_KV"
id = "你的_KV_命名空间_id"
```

`binding` 必须为 `SUB_TRACK_KV`（与 `worker.js` 中 `env.SUB_TRACK_KV` 一致）。

#### B2. 部署

```bash
npx wrangler deploy
```

在浏览器打开 Worker 域名根路径 `/`，使用管理员账号登录（见下文「配置项」与「安全建议」）。

### 方式 C：在 Cloudflare 控制台手动部署 `worker.js`

适用于不想在本机安装 Node、或只想在网页里粘贴代码的场景。

#### C1. 创建 Worker

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Workers 和 Pages** → **创建** → **创建 Worker**。
2. 命名后进入编辑器，**删除默认代码**，将本仓库 `worker.js` 的全部内容粘贴进去（或在本机用「上传」/ 从 Git 复制）。
3. **保存并部署**。

> 仓库内 `worker.js` 已包含内嵌 Tailwind CSS，一般无需先执行 `npm run build`。若你自行改过样式，请先在本地 `npm run build` 再上传更新后的 `worker.js`。

#### C2. 手动绑定 KV

Worker **必须**绑定名为 `SUB_TRACK_KV` 的 KV 命名空间，否则无法读写配置与订阅数据（访问 `/debug` 也会显示 `kvBinding: false`）。

**步骤：**

1. **创建 KV 命名空间**（若还没有）  
   控制台 → **Workers KV** → **创建命名空间**，例如命名为 `subtrack-data`。

2. **绑定到 Worker**  
   进入该 Worker → **设置 (Settings)** → **变量和机密 (Variables and Secrets)** → **KV 命名空间绑定 (KV namespace bindings)** → **添加**：
   - **变量名称 (Variable name)**：`SUB_TRACK_KV`（必须与此字符串完全一致）
   - **KV 命名空间**：选择上一步创建的命名空间

3. **再次部署**  
   保存绑定后，若控制台提示需重新部署，点一次 **部署** 使绑定生效。

**数据说明：** KV 内使用两个键——`config`（系统与通知配置）、`subscriptions`（订阅列表）。首次访问时应用会自动写入默认 `config`。

#### C3. 部署后检查

| 检查项     | 操作                                                   |
| ---------- | ------------------------------------------------------ |
| 页面可打开 | 访问 `https://<你的-worker>.workers.dev/` 应出现登录页 |
| KV 已绑定  | 访问 `/debug`，确认 KV 绑定为已就绪                    |
| 定时提醒   | **Triggers → Cron Triggers** 添加 Cron（见下文）       |
| 安全       | 登录后在 `/admin/config` 修改默认管理员密码            |

---

## 手动绑定 KV 对照表

无论使用 Wrangler 还是控制台，绑定规则相同：

| 项目               | 值                                           |
| ------------------ | -------------------------------------------- |
| 绑定变量名         | `SUB_TRACK_KV`                           |
| Wrangler `binding` | `SUB_TRACK_KV`                           |
| KV 键              | `config`、`subscriptions`                    |
| 控制台菜单位置     | Worker → 设置 → 变量和机密 → KV 命名空间绑定 |

**Wrangler 查看已有命名空间：**

```bash
npx wrangler kv namespace list
```

**本地开发可选：** 为 preview 再创建一个命名空间并写入 `wrangler.toml` 的 `preview_id`（若使用 `wrangler dev` 的远程 KV 模式）。

## 路由说明

| 路径            | 说明                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| `/`             | 登录页                                                                                  |
| `/admin`        | SubTrack（需登录）                                                                      |
| `/admin/config` | 系统与通知配置（需登录）                                                                |
| `/api/*`        | JSON API（除登录等少数接口外需有效 JWT）                                                |
| `/debug`        | 简易诊断页（KV 绑定、是否存在配置、JWT 密钥是否就绪等），**生产环境建议限制访问或关闭** |

常见 API 前缀：基础路径为 `/api`，例如 `POST /api/login`、`GET /api/subscriptions`、`POST /api/notify/<THIRD_PARTY_API_TOKEN>` 等。

## 定时任务（Cron）

Worker 导出 `scheduled` 处理器。请在 Cloudflare 控制台为该 Worker 配置 **Triggers → Cron**，频率需与提醒粒度匹配（例如按小时提醒则建议至少每小时触发一次）。

## 配置项（存于 KV `config`）

首次访问会通过 `getConfig` 合并默认值；重要字段包括：

- **管理员**：`ADMIN_USERNAME`、`ADMIN_PASSWORD`（务必在首次部署后修改默认密码）
- **安全**：`JWT_SECRET`（若缺失会自动生成并写回 KV）、`THIRD_PARTY_API_TOKEN`（第三方通知 API，留空则禁用）
- **时区与推送窗口**：`TIMEZONE`、`NOTIFICATION_HOURS`（空或含 `*` / `ALL` 表示不限制小时）
- **渠道相关**：如 `NOTIFYX_API_KEY`、`TG_BOT_TOKEN`、`TG_CHAT_ID`、`WEBHOOK_*`、`WECHATBOT_*`、`RESEND_API_KEY`、`EMAIL_*`、`BARK_*` 等
- **行为**：`ENABLED_NOTIFIERS`、`SHOW_LUNAR` 等

完整字段以 `worker.js` 中 `getConfig` 的 `finalConfig` 与配置页表单为准。

## 项目脚本

| 命令                  | 作用                                                   |
| --------------------- | ------------------------------------------------------ |
| `npm run build:css`   | 从 `tailwind.input.css` 编译并压缩到 `dist/app.css`    |
| `npm run build:embed` | 将 `dist/app.css` 嵌入 `worker.js`                     |
| `npm run build`       | 依次执行上述两步（修改样式或升级 Tailwind 后建议执行） |

## 安全建议

1. 修改默认管理员密码与第三方通知令牌。
2. 勿将含真实密钥的 `wrangler.toml` 或导出的 KV 数据提交到公开仓库。
3. 对 `/debug` 采取 IP 限制、单独路由或部署后移除等策略，避免泄露环境信息。

## 许可证

本项目采用 [Apache License 2.0](./LICENSE) 进行许可。除非适用法律要求或书面同意，否则按 “原样” 提供本软件，不附带任何明示或暗示的担保或条件。
