// MCP 工具面：把外部 agent 的工具调用转发给 TT 内扩展。
// 工具清单单一事实源在 src/core/protocol.ts（EXTENSION_TOOLS / BRIDGE_LOCAL_TOOLS），
// 这里只维护每工具的描述/schema/注解/本地实现；Record 类型保证穷尽（漏一个 tsc 即失败）。
// 读类工具 readOnlyHint；操作/eval 类 destructiveHint，由 agent 侧决定确认策略。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EXTENSION_TOOLS, BRIDGE_LOCAL_TOOLS } from '../../src/core/protocol.js';
import type { HubLike } from './hub.js';

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

type ExtensionTool = (typeof EXTENSION_TOOLS)[number];
type LocalTool = (typeof BRIDGE_LOCAL_TOOLS)[number];
export type AnyToolName = ExtensionTool | LocalTool;

type RawShape = Record<string, import('zod').z.ZodTypeAny>;

interface ToolSpec {
  description: string;
  annotations: Record<string, boolean>;
  schema?: RawShape;
  /** 本地实现（不转发给扩展）；省略 = 转发 */
  local?: (args: Record<string, unknown>, hub: HubLike) => Promise<unknown> | unknown;
}

const SPECS: Record<AnyToolName, ToolSpec> = {
  // ---- 检测类（读） ----
  tt_status: {
    description:
      '获取 TauriTavern 当前状态：连接能力、当前角色名、用户名、聊天长度、chatId、chatMetadata 键列表。排查"扩展是否连上/上下文是否可用"先调这个。',
    annotations: readOnly,
  },
  tt_read_messages: {
    description:
      '读取当前聊天的消息列表。返回 index/name/is_user/mes(截断)/swipe 信息/楼层变量(可选)/该层对应的状态栏 iframe 名。includeVariables=true 时返回每层 variables（MVU stat_data 在这里）。',
    schema: {
      from: z.number().int().min(0).optional().describe('起始楼层索引（含），默认 0'),
      to: z.number().int().optional().describe('结束楼层索引（不含），默认到末尾'),
      maxMessageLength: z.number().int().optional().describe('单条消息文本截断长度，默认 2000'),
      includeVariables: z.boolean().optional().describe('是否包含楼层 variables，默认 false'),
    },
    annotations: readOnly,
  },
  tt_get_variables: {
    description:
      "读取变量。floor='latest' 或楼层号 → 返回该楼层按 swipe_id 解析后的 variables（MVU 的 stat_data 所在）；不传 floor → 返回聊天级 chatMetadata.variables。",
    schema: {
      floor: z.string().optional().describe("'latest' 或楼层号；省略则读聊天级 chatMetadata 变量"),
    },
    annotations: readOnly,
  },
  tt_get_character: {
    description:
      '读取角色卡。section=summary（默认）返回摘要字段+全部键名（可发现 MVU/世界书等内嵌数据键）；section=full 返回完整卡对象（可能很大）；section=regexes 返回角色内嵌正则完整定义；section=scripts 返回酒馆助手脚本清单（includeContent=true 带全文）；section=character_book 返回内嵌世界书条目清单。name 可指定其他卡。',
    schema: {
      name: z.string().optional().describe('角色名或 avatar 文件名，默认当前角色'),
      section: z
        .enum(['summary', 'full', 'regexes', 'scripts', 'character_book'])
        .optional()
        .describe('读取分区，默认 summary'),
      full: z.boolean().optional().describe('等价 section=full（向后兼容），默认 false'),
      includeContent: z
        .boolean()
        .optional()
        .describe('section=scripts 时是否带脚本全文，默认 false（只给摘要）'),
    },
    annotations: readOnly,
  },
  tt_worldinfo_last: {
    description:
      '获取最近一次 AI 请求中实际激活的世界书条目批次（含条目名、世界、constant、position）。',
    annotations: readOnly,
  },
  tt_llm_logs: {
    description:
      'AI 请求日志。不传 id → 返回最近请求列表（端点/模型/耗时/成败）；id=<n>&raw=false → 格式化预览；id=<n>&raw=true → 原始 JSON 请求/响应（查 prompt 组装必用）。',
    schema: {
      id: z.number().int().optional().describe('日志 id，来自列表'),
      raw: z.boolean().optional().describe('true 返回原始载荷，默认 false'),
      limit: z.number().int().optional().describe('列表长度，默认 20'),
    },
    annotations: readOnly,
  },
  tt_logs: {
    description:
      '读取应用日志。kind=frontend（含控制台捕获——先用 tt_console_capture 开全量捕获，才能看到消息 iframe 内的报错）或 backend（Rust 侧）。',
    schema: {
      kind: z.enum(['frontend', 'backend']).describe('日志类型'),
      limit: z.number().int().optional().describe('条数，默认 50'),
    },
    annotations: readOnly,
  },
  tt_iframes: {
    description:
      '列出主文档全部 iframe（含消息楼层 TH-message--*、脚本 TH-script--*）：name、同源与否、脚本数、DOM 规模、有无 Vue、可见尺寸，以及楼层→iframe 名映射。配合 tt_eval 的 frame 参数在指定 iframe 内执行 JS。',
    annotations: readOnly,
  },
  tt_mvu_stat: {
    description:
      'MVU 卡专用速查：最新楼层 stat_data（按 swipe_id 解析）、initvar 楼层探测、最近一条 <UpdateVariable> 原文、全部有变量楼层清单。stat_data 为空对象时带 hint 提醒（truthy 陷阱）。',
    schema: {
      scanFloors: z
        .number()
        .int()
        .optional()
        .describe('向后扫描 <UpdateVariable> 的最大楼层数，默认 30'),
    },
    annotations: readOnly,
  },
  tt_search_chat: {
    description: '全文搜索当前聊天消息（宿主侧索引）。返回命中楼层/score/片段/角色。',
    schema: {
      query: z.string().describe('搜索文本'),
      role: z.string().optional().describe('按角色过滤，如 user/assistant 或角色名'),
      limit: z.number().int().optional().describe('命中上限，默认 20'),
    },
    annotations: readOnly,
  },
  tt_find_message: {
    description:
      '按结构条件找最后一条匹配消息（宿主侧 locate API）：role、hasTopLevelKeys（如 variables/mes/name）、hasExtraKeys（如 send_date）、scanLimit。返回楼层号与消息对象。',
    schema: {
      role: z.string().optional().describe('角色过滤'),
      hasTopLevelKeys: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe('消息顶层键名数组（或逗号分隔），如 "variables"'),
      hasExtraKeys: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .describe('消息 extra 键名数组（或逗号分隔）'),
      scanLimit: z.number().int().optional().describe('最大扫描楼层数'),
    },
    annotations: readOnly,
  },

  // ---- 操作类（写） ----
  tt_exec_stscript: {
    description:
      '在 TauriTavern 内执行 STScript 命令（如 /setvar、/go、/sys、/swipe 等），返回 pipe 结果。会改变酒馆状态，确认命令内容后再调用。',
    schema: {
      command: z.string().describe('STScript 命令，如 "/setvar key=mood happy"'),
    },
    annotations: destructive,
  },
  tt_send_message: {
    description:
      '向当前聊天发送消息。trigger=true（默认）以用户身份发送并触发生成；silent=true 只插入不生成。',
    schema: {
      text: z.string().describe('消息文本'),
      trigger: z.boolean().optional().describe('发送后触发生成，默认 true'),
      silent: z.boolean().optional().describe('静默插入（不触发生成），默认 false'),
    },
    annotations: destructive,
  },
  tt_set_variables: {
    description:
      '写变量。scope=chat → 写聊天级变量并保存聊天；scope=global → 走 /setvar scope=global。values 为键值对象。',
    schema: {
      scope: z.enum(['chat', 'global']).describe('变量作用域'),
      values: z.record(z.string(), z.unknown()).describe('要写入的键值对'),
    },
    annotations: destructive,
  },
  tt_switch_character: {
    description: '切换到指定角色（/go）。需要角色名精确匹配。',
    schema: {
      name: z.string().describe('目标角色名'),
    },
    annotations: destructive,
  },
  tt_worldinfo_open: {
    description:
      '在 TauriTavern 内打开指定世界书条目的编辑器（world + uid 来自 tt_worldinfo_last 的激活批次）。会切换宿主 UI 界面。',
    schema: {
      world: z.string().describe('世界书名'),
      uid: z.union([z.number(), z.string()]).describe('条目 uid'),
    },
    annotations: destructive,
  },
  tt_llm_keep: {
    description:
      '读取/设置 AI 请求日志保留上限。长调试会话建议调大（如 200），避免历史请求被滚动清掉。不传 keep 只读。',
    schema: {
      keep: z.number().int().optional().describe('新的保留上限'),
    },
    annotations: destructive,
  },
  tt_console_capture: {
    description:
      '开启/关闭宿主全量 console 捕获（frontendLogs）。开启后消息 iframe 内脚本报错（如状态栏 SyntaxError）才会进入 tt_logs(kind=frontend)。不传 enabled 只读当前状态。',
    schema: {
      enabled: z.boolean().optional().describe('目标状态；省略则只读'),
    },
    annotations: destructive,
  },

  // ---- 调试类 ----
  tt_eval: {
    description:
      '在 TauriTavern 内执行任意 JS（async，可 await）。不传 frame = 主文档；frame=<iframe name>（来自 tt_iframes，如 TH-message--0--2）= 在该 iframe 自己的 realm 内执行——getAllVariables/Mvu/eventOn 只存在于消息 iframe，读状态栏运行时必须用 frame。任意代码执行能力——仅用于诊断，谨慎调用。',
    schema: {
      code: z.string().describe('要执行的 JS 代码（async 函数体，可 await，可 return）'),
      frame: z
        .string()
        .optional()
        .describe('目标 iframe name（tt_iframes 可查）；省略 = 主文档'),
    },
    annotations: destructive,
  },

  // ---- bridge 本地工具（不转发） ----
  tt_poll_events: {
    description:
      '拉取自上次以来酒馆侧推送的事件（新消息/世界书激活/前端与后端错误日志/LLM 请求完成/扩展自身日志），按 seq 递增。不传 sinceSeq 则从最新一条开始。attached 模式下只含 attach 之后的事件。',
    schema: {
      sinceSeq: z.number().int().optional().describe('上次收到的最大 seq；省略只回最新一条之后'),
    },
    annotations: readOnly,
    local: (args, hub) => {
      const sinceSeq = args.sinceSeq as number | undefined;
      const events = hub.eventsSince(sinceSeq ?? Math.max(0, hub.lastEventSeq() - 1));
      return { lastSeq: hub.lastEventSeq(), events };
    },
  },
  tt_bridge_status: {
    description:
      'bridge 本身的状态：hub 模式（owned/attached）、扩展是否连接、扩展上报的工具列表、运行时长。诊断"agent 能连 bridge 但调不动 TT"时先看这里。',
    annotations: readOnly,
    local: (_args, hub) => ({
      wsListening: !hub.attached,
      mode: hub.attached ? 'attached' : 'owned',
      extConnected: hub.extConnected,
      extTools: hub.extToolList,
      lastEventSeq: hub.lastEventSeq(),
      uptimeSec: Math.round((Date.now() - hub.startedAt) / 1000),
    }),
  },
};

export function buildMcpServer(hub: HubLike): McpServer {
  const server = new McpServer({ name: 'tt-agent-bridge', version: '0.3.0' });

  const forward = (tool: string) => async (args: Record<string, unknown>) => {
    try {
      const data = await hub.callExtension(tool, args);
      return { content: [{ type: 'text' as const, text: stringify(data) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  };

  for (const name of [...EXTENSION_TOOLS, ...BRIDGE_LOCAL_TOOLS] as AnyToolName[]) {
    const spec = SPECS[name];
    if (!spec) {
      throw new Error(`missing MCP spec for tool: ${name} (protocol/src 两处清单不同步)`);
    }
    const handler = spec.local
      ? async (args: Record<string, unknown>) => {
          try {
            const data = await spec.local!(args, hub);
            return { content: [{ type: 'text' as const, text: stringify(data) }] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text' as const, text: message }], isError: true };
          }
        }
      : forward(name);
    server.registerTool(
      name,
      {
        description: spec.description,
        inputSchema: spec.schema ?? {},
        annotations: spec.annotations,
      },
      handler,
    );
  }

  return server;
}
