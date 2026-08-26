// MCP 工具面：把外部 agent 的工具调用转发给 TT 内扩展。
// 读类工具 readOnlyHint；操作/eval 类 destructiveHint，由 agent 侧决定确认策略。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ExtensionHub } from './hub.js';

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export function buildMcpServer(hub: ExtensionHub): McpServer {
  const server = new McpServer({ name: 'tt-agent-bridge', version: '0.2.0' });

  const forward = (tool: string) => async (args: Record<string, unknown>) => {
    try {
      const data = await hub.callExtension(tool, args);
      return { content: [{ type: 'text' as const, text: stringify(data) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
  const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

  // ---- 检测类（读） ----

  server.registerTool(
    'tt_status',
    {
      description:
        '获取 TauriTavern 当前状态：连接能力、当前角色名、用户名、聊天长度、chatId、chatMetadata 键列表。排查"扩展是否连上/上下文是否可用"先调这个。',
      inputSchema: {},
      annotations: readOnly,
    },
    forward('tt_status'),
  );

  server.registerTool(
    'tt_read_messages',
    {
      description:
        '读取当前聊天的消息列表。返回 index/name/is_user/mes(截断)/swipe 信息/楼层变量(可选)。用于检查楼层内容、swipe 数、消息 extra 键。includeVariables=true 时返回每层 variables（MVU stat_data 在这里）。',
      inputSchema: {
        from: z.number().int().min(0).optional().describe('起始楼层索引（含），默认 0'),
        to: z.number().int().optional().describe('结束楼层索引（不含），默认到末尾'),
        maxMessageLength: z
          .number()
          .optional()
          .describe('单条消息文本截断长度，默认 2000'),
        includeVariables: z.boolean().optional().describe('是否包含楼层 variables，默认 false'),
      },
      annotations: readOnly,
    },
    forward('tt_read_messages'),
  );

  server.registerTool(
    'tt_get_variables',
    {
      description:
        "读取变量。floor='latest' 或楼层号 → 返回该楼层 variables[swipe_id]（MVU 的 stat_data 所在）；不传 floor → 返回聊天级 chatMetadata.variables。",
      inputSchema: {
        floor: z
          .string()
          .optional()
          .describe("'latest' 或楼层号；省略则读聊天级 chatMetadata 变量"),
      },
      annotations: readOnly,
    },
    forward('tt_get_variables'),
  );

  server.registerTool(
    'tt_get_character',
    {
      description:
        '读取角色卡。默认返回当前角色的摘要字段 + 全部键名（含 data.extension_keys，可据此发现 MVU/世界书等内嵌数据键）；full=true 返回完整卡对象（可能很大）；name 可指定其他卡。',
      inputSchema: {
        name: z.string().optional().describe('角色名或 avatar 文件名，默认当前角色'),
        full: z.boolean().optional().describe('返回完整卡 JSON，默认 false'),
      },
      annotations: readOnly,
    },
    forward('tt_get_character'),
  );

  server.registerTool(
    'tt_worldinfo_last',
    {
      description:
        '获取最近一次 AI 请求中实际激活的世界书条目批次（含条目名、世界、constant、position）。',
      inputSchema: {},
      annotations: readOnly,
    },
    forward('tt_worldinfo_last'),
  );

  server.registerTool(
    'tt_llm_logs',
    {
      description:
        'AI 请求日志。不传 id → 返回最近请求列表（端点/模型/耗时/成败）；id=<n>&raw=false → 格式化预览；id=<n>&raw=true → 原始 JSON 请求/响应（查 prompt 组装必用）。',
      inputSchema: {
        id: z.number().int().optional().describe('日志 id，来自列表'),
        raw: z.boolean().optional().describe('true 返回原始载荷，默认 false'),
        limit: z.number().int().optional().describe('列表长度，默认 20'),
      },
      annotations: readOnly,
    },
    forward('tt_llm_logs'),
  );

  server.registerTool(
    'tt_logs',
    {
      description: '读取应用日志。kind=frontend（含控制台捕获）或 backend（Rust 侧）。',
      inputSchema: {
        kind: z.enum(['frontend', 'backend']).describe('日志类型'),
        limit: z.number().int().optional().describe('条数，默认 50'),
      },
      annotations: readOnly,
    },
    forward('tt_logs'),
  );

  // ---- 操作类（写） ----

  server.registerTool(
    'tt_exec_stscript',
    {
      description:
        '在 TauriTavern 内执行 STScript 命令（如 /setvar、/go、/sys、/swipe 等），返回 pipe 结果。会改变酒馆状态，确认命令内容后再调用。',
      inputSchema: {
        command: z.string().describe('STScript 命令，如 "/setvar key=mood happy"'),
      },
      annotations: destructive,
    },
    forward('tt_exec_stscript'),
  );

  server.registerTool(
    'tt_send_message',
    {
      description:
        '向当前聊天发送消息。trigger=true（默认）以用户身份发送并触发生成；silent=true 只插入不生成。',
      inputSchema: {
        text: z.string().describe('消息文本'),
        trigger: z.boolean().optional().describe('发送后触发生成，默认 true'),
        silent: z.boolean().optional().describe('静默插入（不触发生成），默认 false'),
      },
      annotations: destructive,
    },
    forward('tt_send_message'),
  );

  server.registerTool(
    'tt_set_variables',
    {
      description:
        '写变量。scope=chat → 写聊天级变量并保存聊天；scope=global → 走 /setvar scope=global。values 为键值对象。',
      inputSchema: {
        scope: z.enum(['chat', 'global']).describe('变量作用域'),
        values: z.record(z.string(), z.unknown()).describe('要写入的键值对'),
      },
      annotations: destructive,
    },
    forward('tt_set_variables'),
  );

  server.registerTool(
    'tt_switch_character',
    {
      description: '切换到指定角色（/go）。需要角色名精确匹配。',
      inputSchema: {
        name: z.string().describe('目标角色名'),
      },
      annotations: destructive,
    },
    forward('tt_switch_character'),
  );

  // ---- 调试类 ----

  server.registerTool(
    'tt_eval',
    {
      description:
        '在 TauriTavern 主文档中执行任意 JS（async，可 await）。诊断神器：进消息 iframe 检查状态栏渲染、读运行时对象、模拟 srcdoc 链路。返回值 JSON 序列化。任意代码执行能力——仅用于诊断，谨慎调用。',
      inputSchema: {
        code: z.string().describe('要执行的 JS 代码（async 函数体，可 await，可 return）'),
      },
      annotations: destructive,
    },
    forward('tt_eval'),
  );

  // ---- bridge 本地工具（不转发） ----

  server.registerTool(
    'tt_poll_events',
    {
      description:
        '拉取自上次以来酒馆侧推送的事件（新消息、世界书激活、错误日志），按 seq 递增。不传 sinceSeq 则从最新一条开始。',
      inputSchema: {
        sinceSeq: z.number().int().optional().describe('上次收到的最大 seq；省略只回最新一条之后'),
      },
      annotations: readOnly,
    },
    async ({ sinceSeq }) => {
      const events = hub.eventsSince(sinceSeq ?? Math.max(0, hub.lastEventSeq() - 1));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ lastSeq: hub.lastEventSeq(), events }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'tt_bridge_status',
    {
      description:
        'bridge 本身的状态：WS 是否监听、扩展是否连接、扩展上报的工具列表、运行时长。诊断"agent 能连 bridge 但调不动 TT"时先看这里。',
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                wsListening: true,
                extConnected: hub.extConnected,
                extTools: hub.extToolList,
                lastEventSeq: hub.lastEventSeq(),
                uptimeSec: Math.round((Date.now() - hub.startedAt) / 1000),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}
