// WS 桥协议契约 —— 单一事实源。
// bridge 侧通过相对路径直接 import 本文件，禁止两处各抄一份。

export const PROTOCOL_VERSION = 1;

/** bridge -> extension */
export interface CallMsg {
  type: 'call';
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PingMsg {
  type: 'ping';
  t: number;
}

export type ServerToExt = CallMsg | PingMsg;

/** extension -> bridge */
export interface HelloMsg {
  type: 'hello';
  token: string;
  protocolVersion: number;
  ext: { version: string };
  host: {
    /** 扩展已注册的工具 + 宿主能力 */
    capabilities: string[];
  };
}

export interface ResultOkMsg {
  type: 'result';
  id: string;
  ok: true;
  data: unknown;
}

export interface ResultErrMsg {
  type: 'result';
  id: string;
  ok: false;
  error: string;
}

export type BridgeEventName =
  | 'message_added'
  | 'worldinfo_activation'
  | 'log_error'
  | 'extension_log';

export interface EventMsg {
  type: 'event';
  event: BridgeEventName;
  payload: unknown;
}

export interface PongMsg {
  type: 'pong';
  t: number;
}

export type ExtToServer = HelloMsg | ResultOkMsg | ResultErrMsg | EventMsg | PongMsg;

/** 扩展侧必须实现的工具集（bridge 侧据此校验转发） */
export const EXTENSION_TOOLS = [
  'tt_status',
  'tt_read_messages',
  'tt_get_variables',
  'tt_get_character',
  'tt_worldinfo_last',
  'tt_llm_logs',
  'tt_logs',
  'tt_exec_stscript',
  'tt_send_message',
  'tt_set_variables',
  'tt_switch_character',
  'tt_eval',
] as const;

export type ExtensionToolName = (typeof EXTENSION_TOOLS)[number];

/** bridge 侧本地处理的工具（不转发） */
export const BRIDGE_LOCAL_TOOLS = ['tt_poll_events', 'tt_bridge_status'] as const;
