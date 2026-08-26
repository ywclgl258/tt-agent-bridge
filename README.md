# TT Agent Bridge

让外部 CLI agent（ZCode / Claude Code 等）通过 MCP **直接操作 TauriTavern**：读取运行时数据（聊天 / 变量 / 世界书激活 / 日志 / LLM 请求原文 / iframe 状态栏运行时），执行操作（STScript / 发消息 / 写变量 / 切角色 / 跳世界书条目），以及在主文档或**消息 iframe 内**跑任意 JS 诊断酒馆卡。

## 架构

```
外部 Agent（ZCode / Claude Code）           dev 脚本（tteval / ttdiag / regress）
      ↕  MCP over stdio                           ↕  agent 角色直连（ws + JSON）
bridge server（Node，仅监听 127.0.0.1，token 鉴权，支持常驻 daemon）
      ↕  WebSocket（扩展/agent 主动连出，多 agent 并存）
TauriTavern 扩展「TT Agent Bridge」
      ├─→ window.__TAURITAVERN__.api   检测：日志 / 世界书激活 / LLM 请求 / 聊天搜索 / console 捕获
      └─→ SillyTavern.getContext()     操作：STScript / 变量 / 消息 / 事件
```

- 协议契约单一事实源：`src/core/protocol.ts`（bridge 直接 import，勿复制）。
- 扩展只用公开边界（TT 宿主 ABI + 上游 `getContext()` 公开成员），不碰内部模块。
- **bind-or-attach**：MCP server 启动时若端口上已有同 token 的存活 hub（daemon），自动以 agent 身份挂载——多 MCP 客户端并发不再端口冲突。

## 安装扩展（TauriTavern 内）

1. 打开 TauriTavern → 顶部「扩展」抽屉 → **管理扩展** → **安装扩展**
2. 填入本仓库的 Git 地址（TauriTavern 只接受匿名 https Git remote），例如：
   `https://github.com/<你的用户名>/tt-agent-bridge.git`
3. 安装后右下角出现「Bridge」状态徽章（hello 被接受后变绿）

> 手动放置目录（`data/extensions/third-party/tt-agent-bridge/`）也可，但推荐走 Git 安装以便后续更新。
> **升级注意**：协议版本随仓库演进（当前 v2），扩展与 bridge 同仓库同发——拉取新仓库后需同时更新 TT 内扩展（Git 更新或同步 `dist/` + `manifest.json` 后重载页面），否则扩展会被 4003 拒绝（徽章红色、周期重试）。

## 启动

**推荐：常驻 daemon**（扩展保持长连，脚本/MCP 秒级挂载，不再每次等扩展重连）：

```bash
cd bridge
npm install
npm run daemon -- --port 18789 --token <你的token>   # 或 TTAB_PORT / TTAB_TOKEN 环境变量
```

**或直接跑 MCP server**（无 daemon 时自动 bind；有 daemon 时自动 attach）：

```bash
npm run start                          # 随机 token，打印在 stderr，并写入 .bridge-token
# 或固定 token：
npm run start -- --port 18789 --token <你的token>
```

## 配对 token

点击 TT 右下角 Bridge 徽章 → 粘贴 token（server 启动日志里的 `token: ...`）→ 点「重连」→ 徽章变绿即连接成功。token 被拒（4001）时扩展会保持 30 秒慢速重试，修好 token 后自愈。

## 挂到 agent（ZCode / Claude Code）

stdio MCP 方式注册（命令示例，按你的客户端语法调整）：

```bash
zcode mcp add tt-agent-bridge -- npm run start --prefix <bridge目录绝对路径>
```

## MCP 工具一览（21 个）

### 检测类（读）

| 工具 | 用途 |
|---|---|
| `tt_status` | 能力 / 当前角色 / 聊天长度 / chatMetadata 键 |
| `tt_read_messages` | 楼层消息（含 swipe、可选楼层变量、**该层状态栏 iframe 名**） |
| `tt_get_variables` | 聊天级或指定楼层变量（MVU stat_data，按 swipe_id 解析） |
| `tt_get_character` | 角色卡：summary / full / **regexes / scripts / character_book** 分区读取 |
| `tt_worldinfo_last` | 最近一次世界书激活批次 |
| `tt_llm_logs` | AI 请求列表 / 预览 / 原始载荷 |
| `tt_logs` | 前端（含 console 捕获）/ 后端日志 |
| `tt_iframes` | **全部 iframe 清单 + 楼层→iframe 映射**（同源/脚本数/Vue/可见性） |
| `tt_mvu_stat` | **MVU 速查**：最新 stat_data / initvar 楼层 / 最近 `<UpdateVariable>` 原文 |
| `tt_search_chat` | 宿主侧聊天全文搜索 |
| `tt_find_message` | 按结构条件（键名/角色）定位最后一条匹配消息 |

### 操作类（写）

| 工具 | 用途 |
|---|---|
| `tt_exec_stscript` | 执行 STScript |
| `tt_send_message` | 发消息（可触发生成） |
| `tt_set_variables` | 写 chat / global 变量 |
| `tt_switch_character` | 切角色 |
| `tt_worldinfo_open` | 在宿主内打开世界书条目编辑器 |
| `tt_llm_keep` | 读/设 AI 日志保留上限（长调试会话调大） |
| `tt_console_capture` | 开/关宿主全量 console 捕获（iframe 报错进 `tt_logs` 的前置） |

### 调试类

| 工具 | 用途 |
|---|---|
| `tt_eval` | 主文档**或指定 iframe**（`frame=` 参数）内执行任意 JS——`getAllVariables`/`Mvu`/`eventOn` 只在消息 iframe 里，读状态栏运行时必须带 frame |

### bridge 本地

| 工具 | 用途 |
|---|---|
| `tt_poll_events` | 拉取事件流（新消息/世界书激活/前后端错误/LLM 请求完成/扩展日志） |
| `tt_bridge_status` | bridge 状态（owned/attached 模式、扩展连接、工具清单） |

## 典型 debug 场景（酒馆卡）

1. **状态栏空白 / 读不到变量**：
   `tt_mvu_stat` 看 stat_data 是否存在 → `tt_iframes` 找到状态栏 frame → `tt_eval frame=TH-message--0--2` 在 iframe 内查 `getAllVariables()` 与 DOM → `tt_console_capture {enabled:true}` 后 `tt_logs kind=frontend` 看报错（`SyntaxError` 多为 HTML 实体双重解码）。
2. **交互失效（tab 点不动 / 按钮无反应）**：`tt_eval frame=...` 里读脚本源码、查 Vue 挂载（`el.__vue_app__`）、`dispatchEvent` 模拟点击做对照实验。
3. **世界书没生效**：`tt_worldinfo_last` 看激活批次 → `tt_llm_logs` raw 看 prompt 里到底拼了什么 → `tt_worldinfo_open` 直接跳到该条目。
4. **改卡后验证**：`tt_exec_stscript` 触发 `/go` 重载 → `tt_read_messages` 检查渲染结果。
5. **卡结构审查**：`tt_get_character section=regexes|scripts|character_book` 分区读内嵌组件，避免整卡 MB 级 JSON 灌上下文。

## dev 脚本（bridge/scripts/）

| 脚本 | 用途 |
|---|---|
| `lib/agent.mjs` | agent 直连客户端（attach 优先，daemon 不在时 spawn 兜底） |
| `tteval.mjs <file.js>` | 把文件内容作为 `tt_eval` 代码体执行（支持多个文件） |
| `ttdiag.mjs inspect\|switch` | 内置诊断序列 |
| `regress.mjs` | 回归套件：daemon/attach/21 工具/双 agent 并发 |
| `cdp-reload.mjs` | 经 WebView2 CDP（9222）重载 TT 页面 |
| `pngscan.cjs <png> [unpack <dir>]` | 角色卡 PNG 解包检查 / 全量落盘 |
| `smoke.mjs` | MCP stdio 全链路冒烟 |

## 安全边界

- WS 只监听 `127.0.0.1`；握手必须带 token（`--token` / `TTAB_TOKEN`，默认随机生成）。
- 不做任意文件系统 / 命令代理——文件操作 agent 自行用本地工具。
- 写类与 `tt_eval` 标注 destructive，依赖 agent 侧确认策略。
- token 明文存于扩展 localStorage 与 bridge `.bridge-token`，均为本机文件。

## 已知限制

- `/send` 文本通过管道转义传递，含极端字符时以 `tt_eval` 直接操作 context 兜底。
- `set_variables scope=global` 依赖 `/setvar scope=global` 的对象序列化行为。
- attached 模式下 `tt_poll_events` 只含 attach 之后的事件（历史事件在 daemon 的 ring buffer，经 MCP attach 路径不回放）；`tt_bridge_status` 的 extConnected 为 attach 时刻快照。
- TauriTavern 的 `context.characterId` 实测为数字字符串（上游 ST 是 number），bridge 内部已兼容。
- daemon 死亡时 attached 的 MCP server 调用会失败（错误信息明确提示重启 daemon），不自动回退 bind。

## 开发

```bash
npm install && npm run build     # 构建扩展（typecheck + vite -> dist/）
cd bridge && npm install         # bridge 依赖
cd bridge && npm run typecheck   # bridge 侧类型检查
```

仓库根即扩展（manifest.json + dist/），dist 构建产物随仓库提交，TT Git 安装后直接加载；改源码后 `npm run build` 并提交即可被 TT 的扩展更新拉取。
