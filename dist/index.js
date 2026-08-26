function j() {
  return window.__TAURITAVERN__?.api ?? null;
}
async function q() {
  const n = window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__;
  n && await n;
}
let p = null, L = null;
function M() {
  return p !== null;
}
function h() {
  if (!p)
    throw new Error("st-context unavailable: getContext() not resolved");
  return p();
}
async function V() {
  const n = window;
  if (typeof n.SillyTavern?.getContext == "function")
    p = n.SillyTavern.getContext;
  else
    try {
      const e = await import("/scripts/extensions.js");
      typeof e.getContext == "function" && (p = e.getContext);
    } catch {
    }
  if (p && typeof p().executeSlashCommandsWithOptions != "function")
    try {
      const o = (await import("/scripts/slash-commands.js")).SlashCommandParser?.commands?.parse;
      typeof o == "function" && (L = (s) => o(s));
    } catch {
    }
  return p !== null;
}
async function m(n) {
  if (L)
    return L(n);
  const t = h();
  if (typeof t.executeSlashCommandsWithOptions != "function")
    throw new Error("no slash command executor available");
  return t.executeSlashCommandsWithOptions(n);
}
const _ = {
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_SENT: "message_sent"
}, T = "0.2.0", B = 1, P = [
  "tt_status",
  "tt_read_messages",
  "tt_get_variables",
  "tt_get_character",
  "tt_worldinfo_last",
  "tt_llm_logs",
  "tt_logs",
  "tt_exec_stscript",
  "tt_send_message",
  "tt_set_variables",
  "tt_switch_character",
  "tt_eval"
], D = 15e3;
class F {
  constructor(t) {
    this.opts = t;
  }
  opts;
  ws = null;
  retryTimer = null;
  backoffMs = 1e3;
  stopped = !0;
  generation = 0;
  get state() {
    return this.stopped ? "disabled" : this.ws?.readyState === WebSocket.OPEN ? "connected" : this.retryTimer !== null || this.ws?.readyState === WebSocket.CONNECTING ? "connecting" : "disconnected";
  }
  start() {
    this.stopped && (this.stopped = !1, this.backoffMs = 1e3, this.open());
  }
  stop() {
    this.stopped = !0, this.generation++, this.clearRetry(), this.ws && (this.ws.onclose = null, this.ws.close(), this.ws = null), this.opts.onStateChange("disabled");
  }
  restart() {
    this.stop(), this.start();
  }
  sendEvent(t, e) {
    this.rawSend({ type: "event", event: t, payload: e });
  }
  rawSend(t) {
    this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify(t));
  }
  open() {
    if (this.stopped) return;
    this.clearRetry(), this.generation++;
    const t = this.generation, e = this.opts.getPort(), r = this.opts.getToken(), o = `ws://127.0.0.1:${e}/bridge`;
    this.opts.onStateChange("connecting", o);
    let s;
    try {
      s = new WebSocket(o);
    } catch (a) {
      this.opts.onLog(`connect failed: ${String(a)}`), this.scheduleRetry();
      return;
    }
    this.ws = s, s.onopen = () => {
      if (t !== this.generation) return;
      const a = {
        type: "hello",
        token: r,
        protocolVersion: B,
        ...this.opts.buildHello()
      };
      s.send(JSON.stringify(a));
    }, s.onmessage = (a) => {
      if (t !== this.generation) return;
      let i;
      try {
        i = JSON.parse(String(a.data));
      } catch {
        this.opts.onLog(`bad message from bridge: ${String(a.data).slice(0, 120)}`);
        return;
      }
      this.handleMessage(i);
    }, s.onclose = (a) => {
      if (t === this.generation) {
        if (this.ws = null, a.code === 4001) {
          this.opts.onStateChange("auth-failed", "token rejected by bridge"), this.opts.onLog("auth failed: token rejected (check token in settings)");
          return;
        }
        this.scheduleRetry();
      }
    }, s.onerror = () => {
      t === this.generation && this.opts.onLog("websocket error");
    };
  }
  async handleMessage(t) {
    if (t.type === "ping") {
      this.rawSend({ type: "pong", t: t.t });
      return;
    }
    if (t.type !== "call") return;
    const e = await this.opts.dispatcher.handle(t.tool, t.args);
    e.ok ? this.rawSend({ type: "result", id: t.id, ok: !0, data: e.data }) : this.rawSend({ type: "result", id: t.id, ok: !1, error: e.error });
  }
  scheduleRetry() {
    if (this.stopped || this.retryTimer !== null) return;
    this.opts.onStateChange("disconnected", `retry in ${Math.round(this.backoffMs / 1e3)}s`);
    const t = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, D), this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null, this.open();
    }, t);
  }
  clearRetry() {
    this.retryTimer !== null && (window.clearTimeout(this.retryTimer), this.retryTimer = null);
  }
  /** bridge 接受 hello 后状态置绿（由外部在 hello 成功路径调用） */
  noteAuthenticated() {
    this.backoffMs = 1e3, this.opts.onStateChange("connected");
  }
}
class H {
  handlers = /* @__PURE__ */ new Map();
  register(t, e) {
    this.handlers.set(t, e);
  }
  registeredTools() {
    return [...this.handlers.keys()];
  }
  async handle(t, e) {
    const r = this.handlers.get(t);
    if (!r) {
      const o = (this.handlers.size > 0 ? this.registeredTools() : [...P]).join(", ");
      return { ok: !1, error: `unknown tool: ${t}. known: ${o}` };
    }
    try {
      return { ok: !0, data: await r(e ?? {}) };
    } catch (o) {
      return { ok: !1, error: o instanceof Error ? o.message : String(o) };
    }
  }
}
class l extends Error {
}
function g(n, t, e) {
  const r = n[t];
  if (r == null) {
    if (e?.required) throw new l(`missing required arg: ${t}`);
    return e?.def ?? "";
  }
  if (typeof r != "string") throw new l(`arg ${t} must be a string`);
  return r;
}
function y(n, t, e) {
  const r = n[t];
  if (r == null) return e?.def;
  const o = typeof r == "number" ? r : Number(r);
  if (!Number.isFinite(o)) throw new l(`arg ${t} must be a number`);
  let s = o;
  return e?.min !== void 0 && (s = Math.max(e.min, s)), e?.max !== void 0 && (s = Math.min(e.max, s)), s;
}
function x(n, t, e = !1) {
  const r = n[t];
  return r == null ? e : r === !0 || r === "true";
}
function z(n, t = 6) {
  const e = /* @__PURE__ */ new WeakSet();
  let r = 0;
  const o = (s) => {
    if (s !== void 0) {
      if (s === null || typeof s == "number" || typeof s == "boolean") return s;
      if (typeof s == "bigint") return s.toString() + "n";
      if (typeof s == "string") return s.length > 2e5 ? s.slice(0, 2e5) + "…[truncated]" : s;
      if (typeof s == "function") return `[fn ${s.name || "anonymous"}]`;
      if (typeof s == "symbol") return s.toString();
      if (s instanceof Error) return { name: s.name, message: s.message, stack: s.stack };
      if (typeof s == "object") {
        if (e.has(s)) return "[Circular]";
        if (r >= t) return "[MaxDepth]";
        e.add(s), r++;
        try {
          if (Array.isArray(s)) return s.slice(0, 1e3).map(o);
          const a = {};
          for (const [i, u] of Object.entries(s))
            a[i] = o(u);
          return a;
        } finally {
          r--;
        }
      }
      return String(s);
    }
  };
  return JSON.stringify(o(n), null, 2);
}
function O(n, t) {
  return n.length <= t ? n : n.slice(0, t) + `…[+${n.length - t} chars]`;
}
const G = [
  "name",
  "avatar",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "tags",
  "creator",
  "character_version",
  "talkativeness",
  "favorites"
];
function J(n, t, e, r) {
  const o = {
    index: t,
    name: n.name,
    is_user: n.is_user,
    is_system: n.is_system,
    mes: O(String(n.mes ?? ""), e),
    swipe_id: n.swipe_id,
    swipe_count: Array.isArray(n.swipes) ? n.swipes.length : void 0,
    send_date: n.send_date
  };
  return r && n.variables !== void 0 && (o.variables = n.variables), n.extra && Object.keys(n.extra).length > 0 && (o.extra_keys = Object.keys(n.extra)), o;
}
function W(n) {
  return {
    async tt_status() {
      const t = {
        extension: { version: n.extVersion, stContext: M() },
        capabilities: n.hostApi ? [
          "st-context",
          ...n.hostApi.dev?.frontendLogs ? ["dev.frontendLogs"] : [],
          ...n.hostApi.dev?.backendLogs ? ["dev.backendLogs"] : [],
          ...n.hostApi.dev?.llmApiLogs ? ["dev.llmApiLogs"] : [],
          ...n.hostApi.worldInfo ? ["worldInfo"] : [],
          ...n.hostApi.chat ? ["chat"] : []
        ] : ["st-context"]
      };
      if (M()) {
        const e = h();
        t.chat = {
          length: Array.isArray(e.chat) ? e.chat.length : null,
          chatId: e.chatId ?? null,
          chatMetadataKeys: e.chatMetadata ? Object.keys(e.chatMetadata) : []
        }, t.character = {
          name: e.name2 ?? null,
          userName: e.name1 ?? null,
          characterId: e.characterId ?? null,
          groupId: e.groupId ?? null
        };
      }
      return t;
    },
    async tt_read_messages(t) {
      const r = h().chat;
      if (!Array.isArray(r)) throw new l("context.chat is not an array");
      const o = y(t, "from", { min: 0 }) ?? 0, s = y(t, "to", { min: o, max: r.length }) ?? r.length, a = y(t, "maxMessageLength", { def: 2e3, min: 100, max: 2e5 }), i = x(t, "includeVariables", !1), u = r.slice(o, s);
      return {
        total: r.length,
        from: o,
        to: s,
        messages: u.map((c, d) => J(c, o + d, a, i))
      };
    },
    async tt_get_variables(t) {
      const e = h(), r = g(t, "floor", { def: "" });
      if (r !== "") {
        const o = e.chat;
        if (!Array.isArray(o)) throw new l("context.chat is not an array");
        let s, a;
        if (r === "latest")
          s = o[o.length - 1], a = o.length - 1;
        else {
          const i = Number(r);
          if (!Number.isInteger(i) || i < 0 || i >= o.length)
            throw new l(`floor index out of range: ${r} (chat length ${o.length})`);
          s = o[i], a = i;
        }
        if (!s) throw new l("chat is empty");
        return {
          index: a,
          swipe_id: s.swipe_id,
          variables: s.variables ?? null
        };
      }
      return {
        chatMetadata: e.chatMetadata?.variables ?? null
      };
    },
    async tt_get_character(t) {
      const e = h(), r = e.characters;
      if (!Array.isArray(r)) throw new l("context.characters is not available");
      const o = g(t, "name", { def: "" }), s = x(t, "full", !1);
      let a;
      if (o) {
        if (a = r.find(
          (c) => String(c.name ?? "") === o || String(c.avatar ?? "") === o
        ), !a) {
          const c = r.map((d) => String(d.name ?? d.avatar ?? "?"));
          throw new l(`character not found: ${o}. available: ${c.join(", ")}`);
        }
      } else {
        const c = e.characterId;
        if (typeof c != "number" || !r[c])
          throw new l("no active character (characterId is null or invalid)");
        a = r[c];
      }
      if (s) return a;
      const i = {};
      for (const c of G) {
        const d = a[c];
        typeof d == "string" ? i[c] = O(d, 400) : d !== void 0 && (i[c] = d);
      }
      i.all_keys = Object.keys(a);
      const u = a.data;
      if (u && typeof u == "object") {
        i.data_keys = Object.keys(u);
        const c = u.extensions;
        c && typeof c == "object" && (i.extension_keys = Object.keys(c));
      }
      return i;
    },
    async tt_worldinfo_last() {
      const t = n.hostApi?.worldInfo;
      if (!t) throw new l("worldInfo API unavailable on this host");
      return t.getLastActivation();
    }
  };
}
function k(n) {
  return n.replace(/\|/g, "\\|");
}
function U() {
  return {
    async tt_exec_stscript(n) {
      const t = g(n, "command", { required: !0 }), e = await m(t);
      if (e.isError)
        throw new l(`STScript error: ${e.errorMessage ?? "unknown"}`);
      return { pipe: e.pipe ?? null };
    },
    async tt_send_message(n) {
      const t = g(n, "text", { required: !0 }), e = x(n, "trigger", !0);
      if (x(n, "silent", !1) || !e)
        return await m(`/send ${k(t)}`), { sent: !0, triggered: !1 };
      const o = await m(`/send ${k(t)} | /trigger`);
      if (o.isError)
        throw new l(`send failed: ${o.errorMessage ?? "unknown"}`);
      return { sent: !0, triggered: !0 };
    },
    async tt_set_variables(n) {
      const t = g(n, "scope", { def: "chat" }), e = n.values;
      if (!e || typeof e != "object" || Array.isArray(e))
        throw new l("arg values must be an object of key->value");
      const r = Object.entries(e);
      if (r.length === 0) throw new l("values is empty");
      if (t === "chat") {
        const o = h(), s = o.chatMetadata ??= {}, a = s.variables ??= {};
        return Object.assign(a, e), typeof o.saveChat == "function" && await o.saveChat(), { scope: t, written: r.map(([i]) => i), persisted: !0 };
      }
      if (t === "global") {
        for (const [o, s] of r) {
          const a = typeof s == "string" ? s : JSON.stringify(s), i = await m(
            `/setvar scope=global key=${JSON.stringify(o)} ${k(a)}`
          );
          if (i.isError)
            throw new l(`setvar failed for ${o}: ${i.errorMessage ?? "unknown"}`);
        }
        return { scope: t, written: r.map(([o]) => o) };
      }
      throw new l(`unknown scope: ${t} (use 'chat' or 'global')`);
    },
    async tt_switch_character(n) {
      const t = g(n, "name", { required: !0 }), e = await m(`/go ${k(t)}`);
      if (e.isError)
        throw new l(
          `switch failed: ${e.errorMessage ?? "unknown"} (check exact character name)`
        );
      return { switched: !0 };
    }
  };
}
function Y(n) {
  return {
    async tt_logs(t) {
      const e = g(t, "kind", { def: "frontend" }), r = y(t, "limit", { def: 50, min: 1, max: 500 }), o = n.hostApi?.dev;
      if (!o) throw new l("dev API unavailable on this host");
      if (e === "frontend") {
        if (!o.frontendLogs) throw new l("dev.frontendLogs unavailable");
        const s = await o.frontendLogs.list({ limit: r });
        return { kind: e, entries: s };
      }
      if (e === "backend") {
        if (!o.backendLogs) throw new l("dev.backendLogs unavailable");
        const s = await o.backendLogs.tail({ limit: r });
        return { kind: e, entries: s };
      }
      throw new l(`unknown kind: ${e} (use 'frontend' or 'backend')`);
    },
    async tt_llm_logs(t) {
      const e = n.hostApi?.dev;
      if (!e?.llmApiLogs) throw new l("dev.llmApiLogs unavailable on this host");
      const r = y(t, "id");
      if (r !== void 0)
        return x(t, "raw", !1) ? e.llmApiLogs.getRaw(r) : e.llmApiLogs.getPreview(r);
      const o = y(t, "limit", { def: 20, min: 1, max: 200 });
      return e.llmApiLogs.index({ limit: o });
    },
    async tt_eval(t) {
      const e = g(t, "code", { required: !0 }), o = await new Function(
        `"use strict";return (async () => {
` + e + `
})()`
      )();
      return o === void 0 ? null : typeof o == "string" ? o : JSON.parse(z(o));
    }
  };
}
const N = "tt-agent-bridge.settings", E = {
  enabled: !0,
  port: 18789,
  token: ""
};
function K() {
  let n = t();
  function t() {
    try {
      const r = localStorage.getItem(N);
      if (!r) return { ...E };
      const o = JSON.parse(r);
      return {
        enabled: typeof o.enabled == "boolean" ? o.enabled : E.enabled,
        port: typeof o.port == "number" && o.port > 0 && o.port < 65536 ? o.port : E.port,
        token: typeof o.token == "string" ? o.token : ""
      };
    } catch {
      return { ...E };
    }
  }
  const e = /* @__PURE__ */ new Set();
  return {
    get state() {
      return n;
    },
    update(r) {
      n = { ...n, ...r };
      try {
        localStorage.setItem(N, JSON.stringify(n));
      } catch {
      }
      for (const o of e) o(n);
    },
    subscribe(r) {
      return e.add(r), () => e.delete(r);
    }
  };
}
const X = `
  :host {
    all: initial;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 99999;
  }
  .wrap { position: relative; }
  .badge {
    display: flex; align-items: center; gap: 6px;
    background: rgba(20, 20, 24, 0.88);
    color: #eee;
    border-radius: 999px;
    padding: 5px 12px 5px 8px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .dot.connected { background: #3ecf6e; }
  .dot.connecting, .dot.disconnected { background: #e6b450; }
  .dot.auth-failed { background: #e6544e; }
  .dot.disabled { background: #888; }
  .panel {
    position: absolute; right: 0; bottom: 36px;
    width: 300px;
    background: rgba(24, 24, 28, 0.96);
    color: #ddd;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 12px;
    font-size: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  }
  .panel.hidden { display: none; }
  h3 { margin: 0 0 8px; font-size: 13px; color: #fff; }
  .row { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .row label { flex: none; width: 46px; color: #aaa; }
  .row input[type=number], .row input[type=password] {
    flex: 1; min-width: 0;
    background: #111; color: #eee;
    border: 1px solid #333; border-radius: 6px;
    padding: 4px 6px; font-size: 12px;
  }
  .status { color: #9c9; margin: 6px 0; word-break: break-all; }
  .status.err { color: #e6544e; }
  button {
    background: #2c5f8a; color: #fff; border: none;
    border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;
  }
  button:hover { background: #3775a8; }
  .logs {
    margin-top: 8px;
    max-height: 140px; overflow-y: auto;
    background: #111; border-radius: 6px; padding: 6px;
    font-family: ui-monospace, Consolas, monospace; font-size: 11px;
    color: #9a9; white-space: pre-wrap; word-break: break-all;
  }
`;
function Q(n) {
  const t = document.createElement("div");
  t.id = "tt-agent-bridge-ui";
  const e = t.attachShadow({ mode: "open" });
  e.innerHTML = `
    <style>${X}</style>
    <div class="wrap">
      <div class="badge"><span class="dot disabled"></span><span class="label">Bridge</span></div>
      <div class="panel hidden">
        <h3>TT Agent Bridge</h3>
        <div class="status">initializing…</div>
        <div class="row"><label>启用</label><input type="checkbox" class="enabled"></div>
        <div class="row"><label>端口</label><input type="number" class="port" min="1" max="65535"></div>
        <div class="row"><label>Token</label><input type="password" class="token" placeholder="粘贴 bridge token"></div>
        <div class="row">
          <button class="reconnect">重连</button>
          <button class="close">收起</button>
        </div>
        <div class="logs"></div>
      </div>
    </div>
  `;
  const r = e.querySelector(".badge"), o = e.querySelector(".dot"), s = e.querySelector(".label"), a = e.querySelector(".panel"), i = e.querySelector(".status"), u = e.querySelector(".enabled"), c = e.querySelector(".port"), d = e.querySelector(".token"), b = e.querySelector(".reconnect"), C = e.querySelector(".close"), A = e.querySelector(".logs"), S = [];
  r.addEventListener("click", () => a.classList.toggle("hidden")), C.addEventListener("click", () => a.classList.add("hidden"));
  const { settings: w } = n;
  u.checked = w.state.enabled, c.value = String(w.state.port), d.value = w.state.token, u.addEventListener("change", () => w.update({ enabled: u.checked })), c.addEventListener("change", () => {
    const f = Number(c.value);
    Number.isInteger(f) && f > 0 && f < 65536 && w.update({ port: f });
  }), d.addEventListener("change", () => w.update({ token: d.value.trim() })), b.addEventListener("click", () => n.onManualRestart());
  function $(f, v) {
    o.className = `dot ${f}`;
    const R = {
      connected: "Bridge ✓",
      connecting: "Bridge …",
      "auth-failed": "Bridge ✗",
      disconnected: "Bridge ×",
      disabled: "Bridge off"
    };
    s.textContent = R[f], i.textContent = v ? `${f}: ${v}` : f, i.className = f === "auth-failed" ? "status err" : "status";
  }
  return document.body.appendChild(t), {
    setState: $,
    log(f) {
      const v = `${(/* @__PURE__ */ new Date()).toLocaleTimeString()} ${f}`;
      S.push(v), S.length > 30 && S.shift(), A.textContent = S.join(`
`), A.scrollTop = A.scrollHeight;
    },
    dispose() {
      t.remove();
    }
  };
}
const I = [];
function Z() {
  return document.readyState !== "loading" ? Promise.resolve() : new Promise((n) => {
    document.addEventListener("DOMContentLoaded", () => n(), { once: !0 });
  });
}
function ee(n, t = 200) {
  const e = typeof n == "string" ? n : String(n ?? "");
  return e.length > t ? e.slice(0, t) + "…" : e;
}
function te(n, t) {
  const e = [];
  if (M()) {
    const r = h().eventSource;
    if (r) {
      const o = (s) => {
        const a = h().chat, i = Array.isArray(a) ? a.length - 1 : null, u = s && typeof s == "object" && "name" in s ? String(s.name ?? "") : "", c = s && typeof s == "object" && "mes" in s ? ee(s.mes) : "";
        t("message_added", { index: i, name: u, snippet: c });
      };
      r.on(_.MESSAGE_RECEIVED, o), r.on(_.MESSAGE_SENT, o), e.push(() => {
        r.off?.(_.MESSAGE_RECEIVED, o), r.off?.(_.MESSAGE_SENT, o);
      });
    }
  }
  n?.worldInfo?.subscribeActivations && n.worldInfo.subscribeActivations((r) => t("worldinfo_activation", r)).then((r) => e.push(r)).catch(() => {
  }), n?.dev?.frontendLogs?.subscribe && n.dev.frontendLogs.subscribe((r) => {
    r.level === "error" && t("log_error", r);
  }).then((r) => e.push(r)).catch(() => {
  }), I.push(() => {
    for (const r of e)
      try {
        r();
      } catch {
      }
  });
}
async function ne() {
  await Z(), await q();
  const n = j(), t = await V(), e = new H(), r = W({ hostApi: n, extVersion: T }), o = U(), s = Y({ hostApi: n });
  for (const [d, b] of Object.entries({ ...r, ...o, ...s }))
    e.register(d, b);
  const a = K();
  let i = null;
  const u = Q({
    settings: a,
    onManualRestart: () => i?.restart()
  });
  I.push(() => u.dispose()), i = new F({
    getPort: () => a.state.port,
    getToken: () => a.state.token,
    buildHello: () => ({
      ext: { version: T },
      host: { capabilities: e.registeredTools() }
    }),
    dispatcher: e,
    onStateChange: (d, b) => {
      u.setState(d, b), d === "connected" && u.log("bridge connected");
    },
    onLog: (d) => u.log(d)
  });
  const c = () => {
    a.state.enabled ? i?.restart() : (i?.stop(), u.setState("disabled"));
  };
  a.subscribe(c), c(), te(n, (d, b) => i?.sendEvent(d, b)), u.log(`extension v${T} loaded (st-context: ${t ? "ok" : "unavailable"})`), window.addEventListener("pagehide", re, { once: !0 });
}
function re() {
  for (const n of I.splice(0))
    try {
      n();
    } catch {
    }
}
ne().catch((n) => {
  console.error("[TT Agent Bridge] bootstrap failed:", n);
});
