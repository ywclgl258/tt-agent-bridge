# TT Agent Bridge

让外部 CLI agent（ZCode / Claude Code 等）通过 MCP **直接操作 TauriTavern**：读取运行时数据（聊天 / 变量 / 世界书激活 / 日志 / LLM 请求原文），执行操作（STScript / 发消息 / 写变量 / 切角色），以及 `tt_eval` 在主文档跑任意 JS 诊断酒馆卡。

## 架构

```
外部 Agent（ZCode / Claude Code）
      ↕  MCP over stdio
bridge server（Node，仅监听 127.0.0.1，token 鉴权）
      ↕  WebSocket（扩展主动连出）
TauriTavern 扩展「TT Agent Bridge」
      ├─→ window.__TAURITAVERN__.api   检测：日志 / 世界书激活 / LLM 请求
      └─→ SillyTavern.getContext()     操作：STScript / 变量 / 消息 / 事件
```

- 协议契约单一事实源：`src/core/protocol.ts`（bridge 直接 import，勿复制）。
- 扩展只用公开边界（TT 宿主 ABI + 上游 `getContext()` 公开成员），不碰内部模块。

## 安装扩展（TauriTavern 内）

1. 打开 TauriTavern → 顶部「扩展」抽屉 → **管理扩展** → **安装扩展**
2. 填入本仓库的 Git 地址（TauriTavern 只接受匿名 https Git remote），例如：
   `https://github.com/<你的用户名>/tt-agent-bridge.git`
3. 安装后右下角出现「Bridge」状态徽章

> 手动放置目录（`data/extensions/third-party/tt-agent-bridge/`）也可，但推荐走 Git 安装以便后续更新。

## 启动 bridge server

```bash
cd bridge
npm install
npm run start                          # 随机 token，打印在 stderr，并写入 .bridge-token
# 或固定 token：
npm run start -- --port 18789 --token <你的token>
# 或环境变量：TTAB_PORT / TTAB_TOKEN
```

## 配对 token

点击 TT 右下角 Bridge 徽章 → 粘贴 token（server 启动日志里的 `token: ...`）→ 点「重连」→ 徽章变绿即连接成功。

## 挂到 agent（ZCode / Claude Code）

stdio MCP 方式注册（命令示例，按你的客户端语法调整）：

```bash
zcode mcp add tt-agent-bridge -- npm run start --prefix <bridge目录绝对路径>
```

## MCP 工具一览

| 工具 | 类型 | 用途 |
|---|---|---|
| `tt_status` | 读 | 能力 / 当前角色 / 聊天长度 |
| `tt_read_messages` | 读 | 楼层消息（含 swipe、可选楼层变量） |
| `tt_get_variables` | 读 | 聊天级或指定楼层变量（MVU stat_data） |
| `tt_get_character` | 读 | 角色卡摘要（键名清单）/ 完整卡 |
| `tt_worldinfo_last` | 读 | 最近一次世界书激活批次 |
| `tt_llm_logs` | 读 | AI 请求列表 / 预览 / 原始载荷 |
| `tt_logs` | 读 | 前端 / 后端日志 |
| `tt_exec_stscript` | **写** | 执行 STScript |
| `tt_send_message` | **写** | 发消息（可触发生成） |
| `tt_set_variables` | **写** | 写 chat / global 变量 |
| `tt_switch_character` | **写** | 切角色 |
| `tt_eval` | **写** | 主文档执行任意 JS（诊断） |
| `tt_poll_events` | 读 | 拉取事件流（新消息/世界书激活/错误日志） |
| `tt_bridge_status` | 读 | bridge 自身状态 |

## 典型 debug 场景（酒馆卡）

1. **状态栏空白 / 读不到变量**：`tt_get_variables floor=latest` 看楼层 `variables[swipe_id].stat_data` 是否存在 → `tt_eval` 进 `iframe[name^="TH-message"]` 查状态栏 DOM 与 `getAllVariables()` → `tt_logs` 看 console 报错（`SyntaxError` 多为 HTML 实体双重解码）。
2. **世界书没生效**：`tt_worldinfo_last` 看激活批次 → `tt_llm_logs` raw 看 prompt 里到底拼了什么。
3. **改卡后验证**：`tt_exec_stscript` 触发 `/go` 重载 → `tt_read_messages` 检查渲染结果。

## 安全边界

- WS 只监听 `127.0.0.1`；握手必须带 token（`--token` / `TTAB_TOKEN`，默认随机生成）。
- 不做任意文件系统 / 命令代理——文件操作 agent 自行用本地工具。
- 写类与 `tt_eval` 标注 destructive，依赖 agent 侧确认策略。
- token 明文存于扩展 localStorage 与 bridge `.bridge-token`，均为本机文件。

## 已知限制

- `/send` 文本通过管道转义传递，含极端字符时以 `tt_eval` 直接操作 context 兜底。
- `set_variables scope=global` 依赖 `/setvar scope=global` 的对象序列化行为。
- 事件 `message_added` 的 index 在窗口化加载下以 `chat.length-1` 近似。

## 开发

```bash
npm install && npm run build     # 构建扩展（typecheck + vite -> dist/）
cd bridge && npm install         # bridge 依赖
```

仓库根即扩展（manifest.json + dist/），dist 构建产物随仓库提交，TT Git 安装后直接加载；改源码后 `npm run build` 并提交即可被 TT 的扩展更新拉取。
