// WS 桥协议契约 —— 单一事实源。
// bridge 侧通过相对路径直接 import 本文件，禁止两处各抄一份。
//
// v2（bridge 0.3.0）：
// - hello 增加 role（extension / agent）；agent 可多连接、可发起 call、接收事件直推。
// - bridge 在 hello 通过后回 welcome ack（扩展据此点亮徽章；agent 从中快照 hub 状态）。
// - 扩展侧 hello.host.tools 取代旧 capabilities 字段（语义如实）。
// - 新增事件：llm_request；log_error payload 带 kind（frontend/backend）。

export const PROTOCOL_VERSION = 2;

/** bridge -> client */
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

/** bridge 接受 hello 后的确认；hub 快照主要给 agent 用 */
export interface WelcomeMsg {
  type: 'welcome';
  protocolVersion: number;
  hub?: {
    extConnected: boolean;
    extTools: string[] | null;
    extVersion: string | null;
    lastEventSeq: number;
    serverStartedAtMs: number;
  };
}

/** 事件直推（仅发给 agent；扩展是事件生产者） */
export interface EventPushMsg {
  type: 'event';
  seq: number;
  t: number;
  event: BridgeEventName;
  payload: unknown;
}

export type ServerToClient =
  | CallMsg
  | PingMsg
  | WelcomeMsg
  | EventPushMsg
  | ResultOkMsg
  | ResultErrMsg;

/** 兼容旧名 */
export type ServerToExt = ServerToClient;

/** extension/agent -> bridge */
export interface ExtensionHelloMsg {
  type: 'hello';
  token: string;
  protocolVersion: number;
  role: 'extension';
  ext: { version: string };
  host: {
    /** 扩展已注册的工具名 */
    tools: string[];
  };
}

export interface AgentHelloMsg {
  type: 'hello';
  token: string;
  protocolVersion: number;
  role: 'agent';
  agent: { name: string; version?: string };
}

export type HelloMsg = ExtensionHelloMsg | AgentHelloMsg;

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
  | 'llm_request'
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

/** 扩展可发的全部消息；agent 还可以额外发 CallMsg（发起工具调用） */
export type ExtToServer = HelloMsg | ResultOkMsg | ResultErrMsg | EventMsg | PongMsg;

export type AgentToServer = AgentHelloMsg | CallMsg | ResultOkMsg | ResultErrMsg | PongMsg;

export type ClientToServer = ExtToServer | AgentToServer;

/** 扩展侧必须实现的工具集（bridge 侧据此注册/校验转发） */
export const EXTENSION_TOOLS = [
  'tt_status',
  'tt_read_messages',
  'tt_get_variables',
  'tt_get_character',
  'tt_worldinfo_last',
  'tt_llm_logs',
  'tt_logs',
  'tt_iframes',
  'tt_mvu_stat',
  'tt_search_chat',
  'tt_find_message',
  'tt_exec_stscript',
  'tt_send_message',
  'tt_set_variables',
  'tt_switch_character',
  'tt_worldinfo_open',
  'tt_llm_keep',
  'tt_console_capture',
  'tt_eval',
] as const;

export type ExtensionToolName = (typeof EXTENSION_TOOLS)[number];

/** bridge 侧本地处理的工具（不转发） */
export const BRIDGE_LOCAL_TOOLS = ['tt_poll_events', 'tt_bridge_status'] as const;
