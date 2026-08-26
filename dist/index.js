function F() {
  return window.__TAURITAVERN__?.api ?? null;
}
async function H() {
  const o = window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__;
  o && await o;
}
function K(o) {
  const t = ["st-context"];
  return o.dev?.frontendLogs && t.push("dev.frontendLogs"), o.dev?.backendLogs && t.push("dev.backendLogs"), o.dev?.llmApiLogs && t.push("dev.llmApiLogs"), o.worldInfo && t.push("worldInfo"), o.chat && t.push("chat"), t;
}
let x = null, C = null;
function $() {
  return x !== null;
}
function _() {
  if (!x)
    throw new Error("st-context unavailable: getContext() not resolved");
  return x();
}
async function P() {
  const o = window;
  if (typeof o.SillyTavern?.getContext == "function")
    x = o.SillyTavern.getContext;
  else
    try {
      const e = await import("/scripts/extensions.js");
      typeof e.getContext == "function" && (x = e.getContext);
    } catch {
    }
  if (x && typeof x().executeSlashCommandsWithOptions != "function")
    try {
      const s = (await import("/scripts/slash-commands.js")).SlashCommandParser?.commands?.parse;
      typeof s == "function" && (C = (r) => s(r));
    } catch {
    }
  return x !== null;
}
async function A(o) {
  if (C)
    return C(o);
  const t = _();
  if (typeof t.executeSlashCommandsWithOptions != "function")
    throw new Error("no slash command executor available");
  return t.executeSlashCommandsWithOptions(o);
}
const L = {
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_SENT: "message_sent"
}, M = "0.3.0", W = 2, q = [
  "tt_status",
  "tt_read_messages",
  "tt_get_variables",
  "tt_get_character",
  "tt_worldinfo_last",
  "tt_llm_logs",
  "tt_logs",
  "tt_iframes",
  "tt_mvu_stat",
  "tt_search_chat",
  "tt_find_message",
  "tt_exec_stscript",
  "tt_send_message",
  "tt_set_variables",
  "tt_switch_character",
  "tt_worldinfo_open",
  "tt_llm_keep",
  "tt_console_capture",
  "tt_eval"
], B = 15e3;
class D {
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
    const t = this.generation, e = this.opts.getPort(), n = this.opts.getToken(), s = `ws://127.0.0.1:${e}/bridge`;
    this.opts.onStateChange("connecting", s);
    let r;
    try {
      r = new WebSocket(s);
    } catch (i) {
      this.opts.onLog(`connect failed: ${String(i)}`), this.scheduleRetry();
      return;
    }
    this.ws = r, r.onopen = () => {
      if (t !== this.generation) return;
      const i = {
        type: "hello",
        token: n,
        protocolVersion: W,
        role: "extension",
        ...this.opts.buildHello()
      };
      r.send(JSON.stringify(i));
    }, r.onmessage = (i) => {
      if (t !== this.generation) return;
      let a;
      try {
        a = JSON.parse(String(i.data));
      } catch {
        this.opts.onLog(`bad message from bridge: ${String(i.data).slice(0, 120)}`);
        return;
      }
      this.handleMessage(a);
    }, r.onclose = (i) => {
      if (t === this.generation) {
        if (this.ws = null, i.code === 4001) {
          this.opts.onStateChange("auth-failed", "token rejected by bridge"), this.opts.onLog("auth failed: token rejected (check token in settings)"), this.backoffMs = Math.max(this.backoffMs, 3e4), this.scheduleRetry("auth");
          return;
        }
        this.scheduleRetry();
      }
    }, r.onerror = () => {
      t === this.generation && this.opts.onLog("websocket error");
    };
  }
  async handleMessage(t) {
    if (t.type === "ping") {
      this.rawSend({ type: "pong", t: t.t });
      return;
    }
    if (t.type === "welcome") {
      this.noteAuthenticated();
      return;
    }
    if (t.type !== "call") return;
    const e = await this.opts.dispatcher.handle(t.tool, t.args);
    e.ok ? this.rawSend({ type: "result", id: t.id, ok: !0, data: e.data }) : this.rawSend({ type: "result", id: t.id, ok: !1, error: e.error });
  }
  scheduleRetry(t) {
    if (this.stopped || this.retryTimer !== null) return;
    this.opts.onStateChange(
      t === "auth" ? "auth-failed" : "disconnected",
      `retry in ${Math.round(this.backoffMs / 1e3)}s`
    );
    const e = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, B), this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null, this.open();
    }, e);
  }
  clearRetry() {
    this.retryTimer !== null && (window.clearTimeout(this.retryTimer), this.retryTimer = null);
  }
  /** bridge 接受 hello 后状态置绿（由外部在 hello 成功路径调用） */
  noteAuthenticated() {
    this.backoffMs = 1e3, this.opts.onStateChange("connected");
  }
}
class U {
  handlers = /* @__PURE__ */ new Map();
  register(t, e) {
    this.handlers.set(t, e);
  }
  registeredTools() {
    return [...this.handlers.keys()];
  }
  async handle(t, e) {
    const n = this.handlers.get(t);
    if (!n) {
      const s = (this.handlers.size > 0 ? this.registeredTools() : [...q]).join(", ");
      return { ok: !1, error: `unknown tool: ${t}. known: ${s}` };
    }
    try {
      return { ok: !0, data: await n(e ?? {}) };
    } catch (s) {
      return { ok: !1, error: s instanceof Error ? s.message : String(s) };
    }
  }
}
class u extends Error {
}
function m(o, t, e) {
  const n = o[t];
  if (n == null) {
    if (e?.required) throw new u(`missing required arg: ${t}`);
    return e?.def ?? "";
  }
  if (typeof n != "string") throw new u(`arg ${t} must be a string`);
  return n;
}
function v(o, t, e) {
  const n = o[t];
  if (n == null) return e?.def;
  const s = typeof n == "number" ? n : Number(n);
  if (!Number.isFinite(s)) throw new u(`arg ${t} must be a number`);
  let r = s;
  return e?.min !== void 0 && (r = Math.max(e.min, r)), e?.max !== void 0 && (r = Math.min(e.max, r)), r;
}
function k(o, t, e = !1) {
  const n = o[t];
  return n == null ? e : n === !0 || n === "true";
}
function z(o, t = 6) {
  const e = /* @__PURE__ */ new WeakSet();
  let n = 0;
  const s = (r) => {
    if (r !== void 0) {
      if (r === null || typeof r == "number" || typeof r == "boolean") return r;
      if (typeof r == "bigint") return r.toString() + "n";
      if (typeof r == "string") return r.length > 2e5 ? r.slice(0, 2e5) + "…[truncated]" : r;
      if (typeof r == "function") return `[fn ${r.name || "anonymous"}]`;
      if (typeof r == "symbol") return r.toString();
      if (r instanceof Error) return { name: r.name, message: r.message, stack: r.stack };
      if (typeof r == "object") {
        if (e.has(r)) return "[Circular]";
        if (n >= t) return "[MaxDepth]";
        e.add(r), n++;
        try {
          if (Array.isArray(r)) return r.slice(0, 1e3).map(s);
          const i = {};
          for (const [a, f] of Object.entries(r))
            i[a] = s(f);
          return i;
        } finally {
          n--;
        }
      }
      return String(r);
    }
  };
  return JSON.stringify(s(o), null, 2);
}
function S(o, t) {
  return o.length <= t ? o : o.slice(0, t) + `…[+${o.length - t} chars]`;
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
function J() {
  const o = {};
  for (const t of document.querySelectorAll("iframe")) {
    const e = /^TH-message--(\d+)--\d+$/.exec(t.name || "");
    if (e) {
      const n = Number(e[1]);
      (o[n] ??= []).push(t.name);
    }
  }
  return o;
}
function N(o) {
  const t = o.variables;
  if (Array.isArray(t)) {
    const e = typeof o.swipe_id == "number" ? o.swipe_id : 0;
    return t[e] ?? t[t.length - 1] ?? null;
  }
  return t ?? null;
}
function Y(o, t, e, n, s) {
  const r = {
    index: t,
    name: o.name,
    is_user: o.is_user,
    is_system: o.is_system,
    mes: S(String(o.mes ?? ""), e),
    swipe_id: o.swipe_id,
    swipe_count: Array.isArray(o.swipes) ? o.swipes.length : void 0,
    send_date: o.send_date
  };
  n && o.variables !== void 0 && (r.variables = o.variables), o.extra && Object.keys(o.extra).length > 0 && (r.extra_keys = Object.keys(o.extra));
  const i = s?.[t];
  return i && i.length > 0 && (r.iframes = i), r;
}
function R(o, t) {
  const e = o[t];
  if (e != null) {
    if (Array.isArray(e)) return e.map((n) => String(n));
    if (typeof e == "string")
      return e.split(",").map((n) => n.trim()).filter((n) => n.length > 0);
    throw new u(`arg ${t} must be a string array or comma-separated string`);
  }
}
function X(o) {
  return {
    async tt_status() {
      const t = {
        extension: { version: o.extVersion, stContext: $() },
        capabilities: o.hostApi ? K(o.hostApi) : ["st-context"]
      };
      if ($()) {
        const e = _();
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
      const n = _().chat;
      if (!Array.isArray(n)) throw new u("context.chat is not an array");
      const s = v(t, "from", { min: 0 }) ?? 0, r = v(t, "to", { min: s, max: n.length }) ?? n.length, i = v(t, "maxMessageLength", { def: 2e3, min: 100, max: 2e5 }), a = k(t, "includeVariables", !1), f = J(), b = n.slice(s, r);
      return {
        total: n.length,
        from: s,
        to: r,
        messages: b.map(
          (c, l) => Y(c, s + l, i, a, f)
        )
      };
    },
    async tt_get_variables(t) {
      const e = _(), n = m(t, "floor", { def: "" });
      if (n !== "") {
        const s = e.chat;
        if (!Array.isArray(s)) throw new u("context.chat is not an array");
        let r, i;
        if (n === "latest")
          r = s[s.length - 1], i = s.length - 1;
        else {
          const a = Number(n);
          if (!Number.isInteger(a) || a < 0 || a >= s.length)
            throw new u(`floor index out of range: ${n} (chat length ${s.length})`);
          r = s[a], i = a;
        }
        if (!r) throw new u("chat is empty");
        return {
          index: i,
          swipe_id: r.swipe_id ?? 0,
          variables: N(r)
        };
      }
      return {
        chatMetadata: e.chatMetadata?.variables ?? null
      };
    },
    async tt_get_character(t) {
      const e = _(), n = e.characters;
      if (!Array.isArray(n)) throw new u("context.characters is not available");
      const s = m(t, "name", { def: "" }), r = k(t, "full", !1), i = m(t, "section", { def: r ? "full" : "summary" });
      let a;
      if (s) {
        if (a = n.find(
          (c) => String(c.name ?? "") === s || String(c.avatar ?? "") === s
        ), !a) {
          const c = n.map((l) => String(l.name ?? l.avatar ?? "?"));
          throw new u(`character not found: ${s}. available: ${c.join(", ")}`);
        }
      } else {
        const c = Number(e.characterId);
        if (!Number.isInteger(c) || c < 0 || c >= n.length || !n[c])
          throw new u("no active character (characterId is null or invalid)");
        a = n[c];
      }
      if (i === "full") return a;
      if (i === "regexes") {
        const c = a.data, l = a, d = c?.extensions?.regex_scripts ?? l.extension?.regex_scripts ?? null;
        return Array.isArray(d) ? {
          section: i,
          count: d.length,
          regexes: d.map((g) => {
            const p = { ...g };
            return typeof p.replaceString == "string" && (p.replaceString = S(p.replaceString, 4e3)), p;
          })
        } : { section: i, count: 0, regexes: [], note: "no embedded regex_scripts found" };
      }
      if (i === "scripts") {
        const c = k(t, "includeContent", !1), l = a.data?.extensions?.tavern_helper, d = l?.scripts ?? l?.script_list;
        let g = [];
        return Array.isArray(d) ? g = d.map((h, p) => {
          const y = h;
          return [String(y.name ?? y.id ?? `#${p}`), y];
        }) : d && typeof d == "object" && (g = Object.entries(d)), {
          section: i,
          count: g.length,
          scripts: g.map(([h, p]) => {
            const y = {
              key: h,
              name: p.name ?? h,
              id: p.id ?? void 0,
              type: p.type ?? void 0,
              enabled: p.enabled ?? void 0
            };
            return typeof p.content == "string" && (y.contentLength = p.content.length, y.content = c ? p.content : S(p.content, 400)), y;
          })
        };
      }
      if (i === "character_book") {
        const l = (a.data?.character_book ?? a.character_book)?.entries;
        if (!Array.isArray(l) && !(l && typeof l == "object"))
          return { section: i, count: 0, entries: [], note: "no character_book found" };
        const d = Array.isArray(l) ? l.map((g, h) => [h, g ?? {}]) : Object.entries(l);
        return {
          section: i,
          count: d.length,
          entries: d.map(([g, h]) => ({
            index: g,
            comment: h.comment ?? h.name ?? null,
            keys: h.key ?? h.keys ?? [],
            secondaryKeys: h.secondary_keys ?? h.keysecondary ?? void 0,
            constant: h.constant ?? void 0,
            enabled: h.enabled ?? h.disable === !1,
            position: h.position ?? void 0,
            order: h.order ?? h.insertion_order ?? void 0,
            contentPreview: typeof h.content == "string" ? S(h.content, 200) : void 0
          }))
        };
      }
      if (i !== "summary")
        throw new u(
          `unknown section: ${i} (use summary | full | regexes | scripts | character_book)`
        );
      const f = {};
      for (const c of G) {
        const l = a[c];
        typeof l == "string" ? f[c] = S(l, 400) : l !== void 0 && (f[c] = l);
      }
      f.all_keys = Object.keys(a);
      const b = a.data;
      if (b && typeof b == "object") {
        f.data_keys = Object.keys(b);
        const c = b.extensions;
        c && typeof c == "object" && (f.extension_keys = Object.keys(c));
      }
      return f;
    },
    async tt_mvu_stat(t) {
      const n = _().chat;
      if (!Array.isArray(n)) throw new u("context.chat is not an array");
      const s = [];
      let r = null, i = null;
      for (let d = 0; d < n.length; d++) {
        const g = n[d];
        if (!g || g.variables === void 0) continue;
        const h = N(g), p = h && typeof h == "object" ? h.stat_data : void 0, y = p && typeof p == "object" && !Array.isArray(p) ? Object.keys(p) : [];
        s.push({
          index: d,
          swipe_id: g.swipe_id ?? 0,
          statKeys: y
        }), i === null && y.length > 0 && (i = d), r = { index: d, swipe_id: g.swipe_id ?? 0, stat_data: p ?? null };
      }
      const a = v(t, "scanFloors", { def: 30, min: 1, max: 500 });
      let f = null;
      const b = /<UpdateVariable\b[^>]*>([\s\S]*?)<\/UpdateVariable>/i;
      for (let d = n.length - 1; d >= Math.max(0, n.length - a); d--) {
        const g = n[d]?.mes;
        if (typeof g != "string") continue;
        const h = b.exec(g);
        if (h) {
          f = { index: d, text: S(h[0], 4e3) };
          break;
        }
      }
      const c = r?.stat_data, l = c && typeof c == "object" && Object.keys(c).length === 0;
      return {
        totalFloors: n.length,
        latest: r,
        latestStatEmpty: l === !0,
        initvarFloor: i,
        floorsWithVariables: s,
        lastUpdateVariable: f,
        hint: l === !0 ? "最新楼层 stat_data 为空对象 {} —— truthy 但无数据；读合并表请在消息 iframe 内用 getAllVariables()" : void 0
      };
    },
    async tt_search_chat(t) {
      const e = o.hostApi?.chat?.current;
      if (!e?.handle) throw new u("chat handle API unavailable on this host");
      const n = m(t, "query", { required: !0 }), s = v(t, "limit", { def: 20, min: 1, max: 200 }), r = m(t, "role", { def: "" }), i = await e.handle(), a = { query: n };
      s !== void 0 && (a.limit = s), r && (a.role = r);
      const f = await i.searchMessages(a);
      return { query: n, hits: f };
    },
    async tt_find_message(t) {
      const e = o.hostApi?.chat?.current;
      if (!e?.handle) throw new u("chat handle API unavailable on this host");
      const n = m(t, "role", { def: "" }), s = R(t, "hasTopLevelKeys"), r = R(t, "hasExtraKeys"), i = v(t, "scanLimit", { min: 1, max: 1e5 }), a = {};
      return n && (a.role = n), s && (a.hasTopLevelKeys = s), r && (a.hasExtraKeys = r), i !== void 0 && (a.scanLimit = i), { found: await (await e.handle()).locate.findLastMessage(a) };
    },
    async tt_worldinfo_last() {
      const t = o.hostApi?.worldInfo;
      if (!t) throw new u("worldInfo API unavailable on this host");
      return t.getLastActivation();
    }
  };
}
function T(o) {
  return o.replace(/\|/g, "\\|");
}
function Q(o) {
  return {
    async tt_exec_stscript(t) {
      const e = m(t, "command", { required: !0 }), n = await A(e);
      if (n.isError)
        throw new u(`STScript error: ${n.errorMessage ?? "unknown"}`);
      return { pipe: n.pipe ?? null };
    },
    async tt_send_message(t) {
      const e = m(t, "text", { required: !0 }), n = k(t, "trigger", !0);
      if (k(t, "silent", !1) || !n)
        return await A(`/send ${T(e)}`), { sent: !0, triggered: !1 };
      const r = await A(`/send ${T(e)} | /trigger`);
      if (r.isError)
        throw new u(`send failed: ${r.errorMessage ?? "unknown"}`);
      return { sent: !0, triggered: !0 };
    },
    async tt_set_variables(t) {
      const e = m(t, "scope", { def: "chat" }), n = t.values;
      if (!n || typeof n != "object" || Array.isArray(n))
        throw new u("arg values must be an object of key->value");
      const s = Object.entries(n);
      if (s.length === 0) throw new u("values is empty");
      if (e === "chat") {
        const r = _(), i = r.chatMetadata ??= {}, a = i.variables ??= {};
        return Object.assign(a, n), typeof r.saveChat == "function" && await r.saveChat(), { scope: e, written: s.map(([f]) => f), persisted: !0 };
      }
      if (e === "global") {
        for (const [r, i] of s) {
          const a = typeof i == "string" ? i : JSON.stringify(i), f = await A(
            `/setvar scope=global key=${JSON.stringify(r)} ${T(a)}`
          );
          if (f.isError)
            throw new u(`setvar failed for ${r}: ${f.errorMessage ?? "unknown"}`);
        }
        return { scope: e, written: s.map(([r]) => r) };
      }
      throw new u(`unknown scope: ${e} (use 'chat' or 'global')`);
    },
    async tt_switch_character(t) {
      const e = m(t, "name", { required: !0 }), n = await A(`/go ${T(e)}`);
      if (n.isError)
        throw new u(
          `switch failed: ${n.errorMessage ?? "unknown"} (check exact character name)`
        );
      return { switched: !0 };
    },
    async tt_worldinfo_open(t) {
      const e = o.hostApi?.worldInfo;
      if (!e?.openEntry)
        throw new u("worldInfo.openEntry unavailable on this host");
      const n = m(t, "world", { required: !0 }), s = t.uid;
      let r;
      if (typeof s == "number") r = s;
      else if (typeof s == "string" && s !== "") r = s;
      else throw new u("missing required arg: uid (number or string)");
      return { opened: (await e.openEntry({ world: n, uid: r })).opened === !0, world: n, uid: r };
    }
  };
}
function Z(o) {
  return o.startsWith("TH-message--") ? "message" : o.startsWith("TH-script--") ? "script" : "other";
}
function ee(o) {
  const t = o.name || "", e = {
    name: t,
    kind: Z(t),
    sameOrigin: !1,
    scripts: null,
    bodyHtmlLength: null,
    domNodes: null,
    hasVue: null,
    visible: o.offsetParent !== null || o.offsetWidth > 0 || o.offsetHeight > 0,
    width: o.offsetWidth,
    height: o.offsetHeight
  };
  try {
    const n = o.contentDocument;
    if (!n) return e;
    e.sameOrigin = !0, e.scripts = n.querySelectorAll("script").length, e.bodyHtmlLength = n.body ? n.body.innerHTML.length : 0, e.domNodes = n.querySelectorAll("*").length;
    const s = o.contentWindow;
    e.hasVue = s ? typeof s.Vue < "u" : !1;
  } catch {
  }
  return e;
}
function te(o) {
  const t = [...document.querySelectorAll("iframe")], e = t.find((s) => s.name === o);
  if (e) return e;
  const n = t.map((s) => s.name || "(anonymous)").slice(0, 30).join(", ");
  throw new u(`iframe not found: ${o}. available: ${n || "(none)"}`);
}
function ne(o, t) {
  let e;
  if (t) {
    const i = te(t).contentWindow;
    if (!i) throw new u(`iframe has no contentWindow: ${t}`);
    e = i;
  } else
    e = window;
  let n;
  try {
    n = e.Function.bind(e);
  } catch (r) {
    throw new u(
      `cannot execute in frame ${t}: likely cross-origin (${String(r).slice(0, 80)})`
    );
  }
  return n(`"use strict";return (async () => {
` + o + `
})()`)();
}
function oe(o) {
  return {
    async tt_logs(t) {
      const e = m(t, "kind", { def: "frontend" }), n = v(t, "limit", { def: 50, min: 1, max: 500 }), s = o.hostApi?.dev;
      if (!s) throw new u("dev API unavailable on this host");
      if (e === "frontend") {
        if (!s.frontendLogs) throw new u("dev.frontendLogs unavailable");
        const r = await s.frontendLogs.list({ limit: n });
        return { kind: e, entries: r };
      }
      if (e === "backend") {
        if (!s.backendLogs) throw new u("dev.backendLogs unavailable");
        const r = await s.backendLogs.tail({ limit: n });
        return { kind: e, entries: r };
      }
      throw new u(`unknown kind: ${e} (use 'frontend' or 'backend')`);
    },
    async tt_llm_logs(t) {
      const e = o.hostApi?.dev;
      if (!e?.llmApiLogs) throw new u("dev.llmApiLogs unavailable on this host");
      const n = v(t, "id");
      if (n !== void 0)
        return k(t, "raw", !1) ? e.llmApiLogs.getRaw(n) : e.llmApiLogs.getPreview(n);
      const s = v(t, "limit", { def: 20, min: 1, max: 200 });
      return e.llmApiLogs.index({ limit: s });
    },
    async tt_llm_keep(t) {
      const e = o.hostApi?.dev?.llmApiLogs;
      if (!e?.getKeep) throw new u("dev.llmApiLogs.getKeep unavailable on this host");
      const n = await e.getKeep(), s = v(t, "keep", { min: 1, max: 1e4 });
      if (s !== void 0) {
        if (!e.setKeep) throw new u("dev.llmApiLogs.setKeep unavailable on this host");
        await e.setKeep(s);
      }
      const r = await e.getKeep();
      return { before: n, after: r, keep: r };
    },
    async tt_console_capture(t) {
      const e = o.hostApi?.dev?.frontendLogs;
      if (!e?.getConsoleCaptureEnabled || !e.setConsoleCaptureEnabled)
        throw new u("dev.frontendLogs console capture API unavailable on this host");
      const n = await e.getConsoleCaptureEnabled();
      t.enabled !== void 0 && await e.setConsoleCaptureEnabled(k(t, "enabled", n));
      const s = await e.getConsoleCaptureEnabled();
      return { before: n, enabled: s };
    },
    async tt_iframes() {
      const e = [...document.querySelectorAll("iframe")].map((s) => ee(s)), n = {};
      for (const s of e) {
        const r = /^TH-message--(\d+)--\d+$/.exec(s.name);
        r && (n[r[1]] ??= []).push(s.name);
      }
      return { count: e.length, iframes: e, messageIframesByFloor: n };
    },
    async tt_eval(t) {
      const e = m(t, "code", { required: !0 }), n = m(t, "frame", { def: "" }), s = await ne(e, n);
      return s === void 0 ? null : typeof s == "string" ? s : JSON.parse(z(s));
    }
  };
}
const j = "tt-agent-bridge.settings", I = {
  enabled: !0,
  port: 18789,
  token: ""
};
function re() {
  let o = t();
  function t() {
    try {
      const n = localStorage.getItem(j);
      if (!n) return { ...I };
      const s = JSON.parse(n);
      return {
        enabled: typeof s.enabled == "boolean" ? s.enabled : I.enabled,
        port: typeof s.port == "number" && s.port > 0 && s.port < 65536 ? s.port : I.port,
        token: typeof s.token == "string" ? s.token : ""
      };
    } catch {
      return { ...I };
    }
  }
  const e = /* @__PURE__ */ new Set();
  return {
    get state() {
      return o;
    },
    update(n) {
      o = { ...o, ...n };
      try {
        localStorage.setItem(j, JSON.stringify(o));
      } catch {
      }
      for (const s of e) s(o);
    },
    subscribe(n) {
      return e.add(n), () => e.delete(n);
    }
  };
}
const se = `
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
function ie(o) {
  const t = document.createElement("div");
  t.id = "tt-agent-bridge-ui";
  const e = t.attachShadow({ mode: "open" });
  e.innerHTML = `
    <style>${se}</style>
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
  const n = e.querySelector(".badge"), s = e.querySelector(".dot"), r = e.querySelector(".label"), i = e.querySelector(".panel"), a = e.querySelector(".status"), f = e.querySelector(".enabled"), b = e.querySelector(".port"), c = e.querySelector(".token"), l = e.querySelector(".reconnect"), d = e.querySelector(".close"), g = e.querySelector(".logs"), h = [];
  n.addEventListener("click", () => i.classList.toggle("hidden")), d.addEventListener("click", () => i.classList.add("hidden"));
  const { settings: p } = o;
  f.checked = p.state.enabled, b.value = String(p.state.port), c.value = p.state.token, f.addEventListener("change", () => p.update({ enabled: f.checked })), b.addEventListener("change", () => {
    const w = Number(b.value);
    Number.isInteger(w) && w > 0 && w < 65536 && p.update({ port: w });
  }), c.addEventListener("change", () => p.update({ token: c.value.trim() })), l.addEventListener("click", () => o.onManualRestart());
  function y(w, E) {
    s.className = `dot ${w}`;
    const V = {
      connected: "Bridge ✓",
      connecting: "Bridge …",
      "auth-failed": "Bridge ✗",
      disconnected: "Bridge ×",
      disabled: "Bridge off"
    };
    r.textContent = V[w], a.textContent = E ? `${w}: ${E}` : w, a.className = w === "auth-failed" ? "status err" : "status";
  }
  return document.body.appendChild(t), {
    setState: y,
    log(w) {
      const E = `${(/* @__PURE__ */ new Date()).toLocaleTimeString()} ${w}`;
      h.push(E), h.length > 30 && h.shift(), g.textContent = h.join(`
`), g.scrollTop = g.scrollHeight;
    },
    dispose() {
      t.remove();
    }
  };
}
const O = [];
function ae() {
  return document.readyState !== "loading" ? Promise.resolve() : new Promise((o) => {
    document.addEventListener("DOMContentLoaded", () => o(), { once: !0 });
  });
}
function ce(o, t = 200) {
  const e = typeof o == "string" ? o : String(o ?? "");
  return e.length > t ? e.slice(0, t) + "…" : e;
}
function le(o, t) {
  const e = [];
  if ($()) {
    const n = _().eventSource;
    if (n) {
      const s = (r) => {
        const i = _().chat, a = Array.isArray(i) ? i.length - 1 : null, f = r && typeof r == "object" && "name" in r ? String(r.name ?? "") : "", b = r && typeof r == "object" && "mes" in r ? ce(r.mes) : "", c = (d) => t("message_added", { index: d, name: f, snippet: b }), l = o?.chat?.current?.windowInfo;
        l ? l().then((d) => {
          d && d.mode === "windowed" && a !== null ? c(d.windowStartIndex + a) : c(a);
        }).catch(() => c(a)) : c(a);
      };
      n.on(L.MESSAGE_RECEIVED, s), n.on(L.MESSAGE_SENT, s), e.push(() => {
        n.off?.(L.MESSAGE_RECEIVED, s), n.off?.(L.MESSAGE_SENT, s);
      });
    }
  }
  o?.worldInfo?.subscribeActivations && o.worldInfo.subscribeActivations((n) => t("worldinfo_activation", n)).then((n) => e.push(n)).catch(() => {
  }), o?.dev?.frontendLogs?.subscribe && o.dev.frontendLogs.subscribe((n) => {
    n.level === "error" && t("log_error", { kind: "frontend", ...n });
  }).then((n) => e.push(n)).catch(() => {
  }), o?.dev?.backendLogs?.subscribe && o.dev.backendLogs.subscribe((n) => {
    n.level === "ERROR" && t("log_error", { kind: "backend", ...n });
  }).then((n) => e.push(n)).catch(() => {
  }), o?.dev?.llmApiLogs?.subscribeIndex && o.dev.llmApiLogs.subscribeIndex((n) => {
    t("llm_request", {
      id: n.id,
      ok: n.ok,
      level: n.level,
      model: n.model ?? null,
      endpoint: n.endpoint,
      durationMs: n.durationMs
    });
  }).then((n) => e.push(n)).catch(() => {
  }), O.push(() => {
    for (const n of e)
      try {
        n();
      } catch {
      }
  });
}
async function de() {
  await ae(), await H();
  const o = F(), t = await P(), e = new U(), n = X({ hostApi: o, extVersion: M }), s = Q({ hostApi: o }), r = oe({ hostApi: o }), i = { ...n, ...s, ...r };
  for (const l of q) {
    const d = i[l];
    typeof d != "function" && console.error(`[TT Agent Bridge] handler missing for protocol tool: ${l}`), e.register(l, d);
  }
  const a = re();
  let f = null;
  const b = ie({
    settings: a,
    onManualRestart: () => f?.restart()
  });
  O.push(() => b.dispose()), f = new D({
    getPort: () => a.state.port,
    getToken: () => a.state.token,
    buildHello: () => ({
      ext: { version: M },
      host: { tools: e.registeredTools() }
    }),
    dispatcher: e,
    onStateChange: (l, d) => {
      b.setState(l, d), l === "connected" && b.log("bridge connected"), f?.sendEvent("extension_log", {
        level: "info",
        message: `connection ${l}${d ? `: ${d}` : ""}`
      });
    },
    onLog: (l) => b.log(l)
  });
  const c = () => {
    a.state.enabled ? f?.restart() : (f?.stop(), b.setState("disabled"));
  };
  a.subscribe(c), c(), le(o, (l, d) => f?.sendEvent(l, d)), b.log(`extension v${M} loaded (st-context: ${t ? "ok" : "unavailable"})`), window.addEventListener("pagehide", ue, { once: !0 });
}
function ue() {
  for (const o of O.splice(0))
    try {
      o();
    } catch {
    }
}
de().catch((o) => {
  console.error("[TT Agent Bridge] bootstrap failed:", o);
});
