/**
 * ayuan - client half for the DSH Web UI.
 *
 * Yuan's global companion: a draggable floating panel and launcher, a native DSH
 * conversation with a Yuan landing state, history, memory, page location and the
 * trajectory view. Plain browser module: no build, no JSX, React from the module
 * loader. Styling uses one injected <style> tag whose classes are prefixed "ay-".
 */
window.__ModuleLoader__.load({
  id: 'ayuan',
  factory(require) {

    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { Menu, IconEllipsisOutlineRegular } = primitives;
    // HoverCard / StateDot 与宿主左侧会话行同源；未来版本若调整导出，缺省时降级为无悬停卡片。
    const HoverCard = primitives.HoverCard;
    const StateDot = primitives.StateDot;
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    /** Locale namespace owned by this plugin. */
    const NS = 'ayuan';
    const EMPTY = Object.freeze([]);
    let boundT = null;
    let clientContext = null;

    function clientService(name) {
      try {
        if (clientContext === null || typeof clientContext.get !== 'function') return null;
        const service = clientContext.get(name);
        return service === undefined ? null : service;
      } catch {
        return null;
      }
    }

    /**
     * 页面 token（Host 注入到 index HTML 的 window.__AYUAN_PAGE_TOKEN__）。
     * DSH 的 cookie 鉴权在部分窗口/重启后会 401，token 让插件 API 不依赖 cookie；
     * cookie 仍是 Host 侧的回退，两边任一通过即可。

    /** 页面 token（Host 注入到 index HTML 的 window.__AYUAN_PAGE_TOKEN__）。 */
    function pageToken() {
      try {
        const value = typeof window !== 'undefined' ? window.__AYUAN_PAGE_TOKEN__ : '';
        return typeof value === 'string' ? value : '';
      } catch {
        return '';
      }
    }

    /** 带页面 token 的同源 fetch；没有 token 时退回普通 cookie 请求。 */
    function apiFetch(url, init) {
      const options = { ...(init || {}) };
      const headers = { ...(options.headers || {}) };
      const token = pageToken();
      if (token !== '') headers['x-ayuan-token'] = token;
      options.headers = headers;
      if (options.credentials === undefined) options.credentials = 'same-origin';
      // 设备中心转发会剥掉自定义 header，所以 token 也允许走查询参数。
      let target = url;
      if (typeof url === 'string' && url.startsWith('/ayuan/')) {
        target = url.slice(1);
        if (token !== '') {
          const separator = target.includes('?') ? '&' : '?';
          target += separator + '_ayuan_token=' + encodeURIComponent(token);
        }
      }
      return fetch(target, options);
    }

    async function apiJson(url, options) {
      const settings = options !== null && typeof options === 'object' ? options : {};
      const init = { credentials: 'same-origin', headers: { accept: 'application/json' } };
      if (typeof settings.method === 'string') init.method = settings.method;
      if (settings.body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(settings.body);
      }
      const response = await apiFetch(url, init);
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok || body === null || typeof body !== 'object' || body.ok !== true) {
        const message =
          body !== null && typeof body === 'object' && typeof body.error === 'string' && body.error !== ''
            ? body.error
            : response.ok
              ? 'invalid response'
              : 'HTTP ' + response.status;
        throw new Error(message);
      }
      return body;
    }


    // -- yuan (阿源) local endpoints ---------------------------------------------
    const YUAN_STATE_API = '/ayuan/api/state';
    const YUAN_SIGNALS_API = '/ayuan/api/signals';
    const YUAN_CHAT_API = '/ayuan/api/chat';
    const YUAN_REMEMBER_API = '/ayuan/api/remember';
    const YUAN_MEMORY_DELETE_API = '/ayuan/api/memory/remove';
    const YUAN_MEMORY_ACCEPT_API = '/ayuan/api/memory/change';
    const YUAN_REMINDER_API = '/ayuan/api/reminder';
    const YUAN_REMINDER_DONE_API = '/ayuan/api/reminder/done';
    const YUAN_SEEN_API = '/ayuan/api/seen';

    function yuanSignalCounts(state) {
      const counts = { suggestion: 0, reminder: 0, deadline: 0 };
      const signals = state !== null && typeof state === 'object' && Array.isArray(state.signals) ? state.signals : EMPTY;
      for (const signal of signals) {
        if (signal === null || typeof signal !== 'object') continue;
        const kind = typeof signal.kind === 'string' ? signal.kind : '';
        const count = typeof signal.count === 'number' && Number.isFinite(signal.count) ? signal.count : 1;
        if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += count;
      }
      return counts;
    }

    function yuanSeverity(state) {
      const signals = state !== null && typeof state === 'object' && Array.isArray(state.signals) ? state.signals : EMPTY;
      let severity = null;
      for (const signal of signals) {
        if (signal === null || typeof signal !== 'object') continue;
        if (signal.kind === 'suggestion' && signal.isNew === false) continue;
        if (signal.severity === 'urgent') return 'urgent';
        if (signal.severity === 'warn') severity = 'warn';
        else if (signal.severity === 'info' && severity === null) severity = 'info';
      }
      if (severity !== null) return severity;
      const badge = state !== null && typeof state === 'object' ? state.badge : null;
      if (badge !== null && typeof badge === 'object') {
        if (toCount(badge.urgent) > 0) return 'urgent';
        if (badge.hasUnread === true) return 'info';
      }
      return null;
    }

    function normalizeYuanState(body) {
      const source = body !== null && typeof body === 'object' ? body : {};
      return {
        name: typeof source.name === 'string' ? source.name : '',
        suggestions: Array.isArray(source.suggestions) ? source.suggestions : [],
        signals: Array.isArray(source.signals) ? source.signals : [],
        badge: source.badge !== undefined ? source.badge : null,
        unread: source.unread !== undefined ? source.unread : null,
        chat: Array.isArray(source.chat) ? source.chat : [],
        memory: Array.isArray(source.memory) ? source.memory : [],
        reminders: Array.isArray(source.reminders) ? source.reminders : [],
        model: source.model !== undefined ? source.model : null,
        agent: source.agent !== undefined ? source.agent : null,
        sessions: Array.isArray(source.sessions) ? source.sessions : [],
        context: source.context || null,
        contextSessionId: source.contextSessionId || source.agent?.sessionId || null,
      };
    }

    function yuanMessageRole(message) {
      return message !== null && typeof message === 'object' && message.role === 'assistant' ? 'assistant' : 'user';
    }

    function yuanMessageText(message) {
      if (message === null || typeof message !== 'object') return '';
      if (typeof message.text === 'string') return message.text;
      if (typeof message.reply === 'string') return message.reply;
      return '';
    }

    function yuanProposalList(proposals) {
      if (Array.isArray(proposals)) {
        return proposals
          .map((item) => (typeof item === 'string' ? { kind: 'todo', text: item } : item))
          .filter((item) => item !== null && typeof item === 'object');
      }
      if (proposals !== null && typeof proposals === 'object') {
        const list = [];
        for (const text of Array.isArray(proposals.todos) ? proposals.todos : EMPTY) {
          if (typeof text === 'string' && text !== '') list.push({ kind: 'todo', text });
        }
        for (const text of Array.isArray(proposals.memories) ? proposals.memories : EMPTY) {
          if (typeof text === 'string' && text !== '') list.push({ kind: 'memory', text });
        }
        for (const item of Array.isArray(proposals.reminders) ? proposals.reminders : EMPTY) {
          if (item !== null && typeof item === 'object' && typeof item.text === 'string') {
            list.push({ kind: 'reminder', text: item.text });
          }
        }
        return list;
      }
      return EMPTY;
    }

    /** Tool calls captured on one assistant message (v0.4.3). */
    function yuanToolList(message) {
      if (message === null || typeof message !== 'object' || !Array.isArray(message.tools)) return EMPTY;
      return message.tools.filter((tool) => tool !== null && typeof tool === 'object');
    }

    /** Hydrate the last assistant chat entry with the tools of a fresh chat response. */
    function withToolsOnLastAssistant(chat, tools, usedAgent) {
      if (!Array.isArray(tools) || tools.length === 0 || !Array.isArray(chat)) return chat;
      const next = chat.slice();
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const message = next[index];
        if (message === null || typeof message !== 'object' || message.role !== 'assistant') continue;
        if (!Array.isArray(message.tools) || message.tools.length === 0) {
          next[index] = {
            ...message,
            tools,
            usedAgent: usedAgent === true || message.usedAgent === true,
          };
        }
        break;
      }
      return next;
    }

    function yuanToolArgumentsText(tool) {
      if (tool === null || typeof tool !== 'object') return '';
      const value = tool.arguments;
      if (typeof value === 'string') return value;
      if (value === undefined || value === null) return '';
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    function yuanToolResultText(tool) {
      if (tool === null || typeof tool !== 'object') return '';
      const value = tool.result;
      if (typeof value === 'string') return value;
      if (value === undefined || value === null) return '';
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    function yuanProposalLabel(proposal, t) {
      const kind = proposal !== null && typeof proposal === 'object' && typeof proposal.kind === 'string' ? proposal.kind : 'todo';
      const text =
        proposal !== null && typeof proposal === 'object' && typeof proposal.text === 'string'
          ? proposal.text
          : String(proposal);
      const key = kind === 'memory' ? 'yuanProposalMemory' : kind === 'reminder' ? 'yuanProposalReminder' : 'yuanProposalTodo';
      return t(key) + ': ' + text;
    }

    function yuanSourceLabel(item, t) {
      if (item === null || typeof item !== 'object') return '';
      if (typeof item.sessionTitle === 'string' && item.sessionTitle !== '') return item.sessionTitle;
      if (item.source === 'session') return t('yuanSourceSession');
      if (item.source === 'note') return t('yuanSourceNote');
      if (typeof item.project === 'string' && item.project !== '') return item.project;
      return '';
    }

    function yuanLocalId(prefix) {
      return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /** Host memory endpoints return `{memories:[...]}` (remember also returns the item). */
    function yuanMemoryList(body, fallback) {
      if (body !== null && typeof body === 'object') {
        if (Array.isArray(body.memories)) return body.memories;
        if (Array.isArray(body.memory)) return body.memory;
      }
      return Array.isArray(fallback) ? fallback : EMPTY;
    }


    async function yuanRequest(url, options) {
      const settings = options !== null && typeof options === 'object' ? options : {};
      const init = { credentials: 'same-origin', headers: { accept: 'application/json' } };
      if (typeof settings.method === 'string') init.method = settings.method;
      if (settings.body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(settings.body);
      }
      const response = await apiFetch(url, init);
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok || body === null || typeof body !== 'object' || body.ok !== true) {
        const message =
          body !== null && typeof body === 'object' && typeof body.error === 'string' && body.error !== ''
            ? body.error
            : response.ok
              ? 'invalid response'
              : 'HTTP ' + response.status;
        throw new Error(message);
      }
      return body;
    }

    /**
     * Module-level Yuan store. Components subscribe with useState + useEffect (no
     * useSyncExternalStore, so the mini-React render harness keeps working).
     */

    const yuan = {
      open: false,
      loading: false,
      error: null,
      state: null,
      sending: false,
      activity: null,
      failedText: null,
      lastLoadedAt: 0,
      lastBoard: null,
      boardSeq: 0,
      lastSeenAt: 0,
      listeners: new Set(),
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      emit() {
        for (const listener of [...this.listeners]) {
          try {
            listener();
          } catch (error) {
            console.error('[ayuan] yuan listener failed', error);
          }
        }
      },
      set(patch) {
        Object.assign(this, patch);
        this.emit();
      },
      patchState(patch) {
        if (this.state === null) return;
        this.state = { ...this.state, ...patch };
        this.emit();
      },
      async load(force) {
        if (this.loading) return this.state;
        if (force !== true && this.state !== null && Date.now() - this.lastLoadedAt < 5000) return this.state;
        this.set({ loading: true, error: null });
        try {
          const body = await yuanRequest(YUAN_STATE_API);
          this.set({ loading: false, error: null, state: normalizeYuanState(body), lastLoadedAt: Date.now() });
        } catch (error) {
          this.set({ loading: false, error: describeError(error) });
        }
        return this.state;
      },
      async pollSignals() {
        try {
          const body = await yuanRequest(YUAN_SIGNALS_API);
          const previous = this.state;
          const next =
            previous === null
              ? normalizeYuanState(body)
              : {
                  ...previous,
                  signals: Array.isArray(body.signals) ? body.signals : previous.signals,
                  badge: body.badge !== undefined ? body.badge : previous.badge,
                  unread: body.unread !== undefined ? body.unread : previous.unread,
                };
          this.set({ state: next, error: null });
        } catch (error) {
          this.set({ error: describeError(error) });
        }
      },
      async send(text, options) {
        const settings = options !== null && typeof options === 'object' ? options : {};
        const message = typeof text === 'string' ? text.trim() : '';
        if (message === '' || this.sending) return null;
        const retry = settings.retry === true && this.failedText !== null;
        const previous = this.state;
        const previousChat = previous !== null && Array.isArray(previous.chat) ? previous.chat : EMPTY;
        const optimistic = retry
          ? null
          : { id: yuanLocalId('local-'), role: 'user', text: message, at: new Date().toISOString() };
        const chat = optimistic === null ? previousChat : [...previousChat, optimistic];
        this.set({ sending: true, error: null, failedText: null });
        this.patchState({ chat });
        let activityBusy = false;
        const activityTimer = setInterval(async () => {
          if (activityBusy) return;
          activityBusy = true;
          try { const result = await yuanRequest('/ayuan/api/activity'); this.set({ activity: result.activity }); }
          catch { /* The chat request supplies the actionable failure. */ }
          finally { activityBusy = false; }
        }, 700);
        try {
          const body = await yuanRequest(YUAN_CHAT_API, { method: 'POST', body: { message } });
          const responseChat = Array.isArray(body.chat) ? withToolsOnLastAssistant(body.chat, body.tools, body.usedAgent) : chat;
          const next =
            previous === null
              ? { ...normalizeYuanState(body), chat: responseChat }
              : {
                  ...previous,
                  chat: responseChat,
                  suggestions: Array.isArray(body.suggestions) ? body.suggestions : previous.suggestions,
                  signals: Array.isArray(body.signals) ? body.signals : previous.signals,
                  badge: body.badge !== undefined ? body.badge : previous.badge,
                  agent: body.agent !== undefined ? body.agent : previous.agent,
                };
          this.set({ sending: false, error: null, failedText: null, state: next });
          return body;
        } catch (error) {
          // Keep the user's optimistic message so it can be retried without retyping.
          this.set({ sending: false, error: describeError(error), failedText: message });
          this.patchState({ chat });
          return null;
        } finally {
          clearInterval(activityTimer);
          this.set({ activity: null });
        }
      },
      async stop() {
        try { await yuanRequest('/ayuan/api/stop', { method: 'POST', body: {} }); }
        catch (error) { this.set({ error: describeError(error) }); }
      },
      async remember(text) {
        const value = typeof text === 'string' ? text.trim() : '';
        if (value === '') return null;
        const previous = this.state !== null && Array.isArray(this.state.memory) ? this.state.memory : EMPTY;
        try {
          const body = await yuanRequest(YUAN_REMEMBER_API, { method: 'POST', body: { text: value } });
          const memory = yuanMemoryList(body, previous);
          if (this.state === null) this.set({ state: { ...normalizeYuanState(body), memory } });
          else this.patchState({ memory });
          return body;
        } catch (error) {
          this.set({ error: describeError(error) });
          return null;
        }
      },
      async deleteMemory(id) {
        if (typeof id !== 'string' || id === '') return null;
        const previous = this.state !== null && Array.isArray(this.state.memory) ? this.state.memory : EMPTY;
        try {
          const body = await yuanRequest(YUAN_MEMORY_DELETE_API, { method: 'POST', body: { id } });
          const memory = yuanMemoryList(
            body,
            previous.filter((item) => item !== null && typeof item === 'object' && item.id !== id),
          );
          if (this.state === null) this.set({ state: { ...normalizeYuanState(body), memory } });
          else this.patchState({ memory });
          return body;
        } catch (error) {
          this.set({ error: describeError(error) });
          return null;
        }
      },
      async acceptMemory(id) {
        if (typeof id !== 'string' || id === '') return null;
        const previous = this.state !== null && Array.isArray(this.state.memory) ? this.state.memory : EMPTY;
        try {
          const body = await yuanRequest(YUAN_MEMORY_ACCEPT_API, { method: 'POST', body: { id } });
          const memory = yuanMemoryList(
            body,
            previous.map((item) =>
              item !== null && typeof item === 'object' && item.id === id ? { ...item, status: 'active' } : item,
            ),
          );
          if (this.state === null) this.set({ state: { ...normalizeYuanState(body), memory } });
          else this.patchState({ memory });
          return body;
        } catch (error) {
          this.set({ error: describeError(error) });
          return null;
        }
      },
      async addReminder(text, at) {
        const value = typeof text === 'string' ? text.trim() : '';
        if (value === '') return null;
        try {
          const body = await yuanRequest(YUAN_REMINDER_API, {
            method: 'POST',
            body: at === undefined || at === null ? { text: value } : { text: value, at },
          });
          this.patchState({
            reminders: Array.isArray(body.reminders) ? body.reminders : this.state !== null ? this.state.reminders : [],
            signals: Array.isArray(body.signals) ? body.signals : this.state !== null ? this.state.signals : [],
          });
          return body;
        } catch (error) {
          this.set({ error: describeError(error) });
          return null;
        }
      },
      async completeReminder(id) {
        if (typeof id !== 'string' || id === '') return null;
        try {
          const body = await yuanRequest(YUAN_REMINDER_DONE_API, { method: 'POST', body: { id } });
          this.patchState({
            reminders: Array.isArray(body.reminders) ? body.reminders : this.state !== null ? this.state.reminders : [],
            signals: Array.isArray(body.signals) ? body.signals : this.state !== null ? this.state.signals : [],
          });
          return body;
        } catch (error) {
          this.set({ error: describeError(error) });
          return null;
        }
      },
      async markSeen() {
        try {
          const body = await yuanRequest(YUAN_SEEN_API, { method: 'POST', body: {} });
          this.set({ lastSeenAt: typeof body.lastSeenAt === 'number' ? body.lastSeenAt : Date.now() });
          this.patchState({ unread: false, signals: (this.state?.signals || []).filter((s) => s.kind !== 'unread').map((s) => s.kind === 'suggestion' ? { ...s, isNew: false } : s), badge: { ...this.state?.badge, hasUnread: false } });
        } catch {
          /* 未读标记失败不影响面板 */
        }
      },
      toggle() {
        if (this.open) this.closePanel();
        else this.openPanel();
      },
      openPanel() {
        this.set({ open: true });
        this.load().then(() => this.markSeen());
      },
      closePanel() {
        this.set({ open: false });
      },
    };

    /** Subscribe a component to the Yuan store with the mini-React-compatible hooks. */

    function useYuanStore() {
      const [, forceRender] = useState(0);
      useEffect(() => {
        const unsubscribe = yuan.subscribe(() => forceRender((value) => value + 1));
        if (yuan.state === null && !yuan.loading) yuan.load();
        return unsubscribe;
      }, []);
      return yuan;
    }

    // DeepSeek whale silhouette adapted from DSH ui-conversation (MIT); Yuan adds a sky badge and sparkle.

    const YUAN_WHALE_PATH = "M22.403 0.567C22.145 0.477 22.068 0.718 21.939 0.85C21.895 0.893 21.86 0.947 21.824 0.997C21.515 1.421 21.13 1.721 20.591 1.77C19.829 1.867 19.221 2.244 18.712 2.958C18.535 2.227 18.116 1.839 17.516 1.626C17.203 1.506 16.887 1.379 16.663 1.064C16.508 0.839 16.462 0.581 16.383 0.329C16.332 0.176 16.283 0.02 16.121 -0.002C15.944 -0.029 15.875 0.133 15.805 0.269C15.52 0.822 15.408 1.43 15.42 2.046C15.449 3.432 16.031 4.532 17.202 5.274C17.337 5.356 17.374 5.445 17.335 5.582C17.261 5.862 17.169 6.134 17.086 6.413C17.032 6.59 16.952 6.63 16.764 6.558C16.118 6.301 15.562 5.909 15.074 5.433C14.248 4.633 13.5 3.751 12.568 3.06C12.349 2.898 12.13 2.748 11.903 2.605C10.952 1.682 12.028 0.923 12.277 0.833C12.537 0.739 12.367 0.416 11.526 0.42C10.684 0.424 9.914 0.706 8.933 1.081C8.789 1.138 8.638 1.179 8.484 1.213C7.593 1.044 6.668 1.006 5.702 1.115C3.883 1.318 2.43 2.178 1.362 3.646C0.079 5.41 -0.223 7.415 0.147 9.506C0.535 11.71 1.66 13.535 3.389 14.962C5.181 16.441 7.246 17.166 9.601 17.027C11.032 16.944 12.624 16.753 14.421 15.232C14.874 15.458 15.35 15.548 16.138 15.615C16.746 15.672 17.331 15.585 17.784 15.491C18.493 15.341 18.444 14.684 18.188 14.564C16.108 13.595 16.565 13.989 16.15 13.67C17.206 12.42 18.82 10.198 19.363 7.086C19.421 6.709 19.484 6.171 19.469 5.866C19.458 5.681 19.493 5.604 19.681 5.556C20.199 5.412 20.691 5.172 21.125 4.806C22.366 3.824 22.758 2.554 22.708 1.1C22.7 0.878 22.649 0.654 22.403 0.567ZM11.175 14.451C9.159 12.726 8.182 12.088 7.778 12.067C7.401 12.047 7.469 12.505 7.552 12.807C7.639 13.103 7.752 13.313 7.91 13.581C8.02 13.758 8.095 14.01 7.801 14.16C7.152 14.487 6.023 13.806 5.97 13.772C4.657 12.85 3.559 11.766 2.785 10.369C2.037 9.025 1.603 7.583 1.532 6.044C1.513 5.672 1.622 5.541 1.992 5.473C2.479 5.383 2.981 5.364 3.468 5.436C5.525 5.736 7.276 6.675 8.744 8.323C9.582 9.299 10.216 10.425 10.869 11.496C11.563 12.592 12.31 13.603 13.262 14.414C13.598 14.696 13.866 14.91 14.123 15.068C13.349 15.154 12.058 15.167 11.175 14.452L11.175 14.451ZM12.141 8.26C12.141 8.095 12.273 7.963 12.439 7.963C12.476 7.963 12.511 7.971 12.541 7.982C12.582 7.997 12.62 8.019 12.65 8.053C12.704 8.106 12.733 8.181 12.733 8.26C12.733 8.425 12.601 8.556 12.435 8.556C12.27 8.556 12.141 8.425 12.141 8.26ZM15.142 9.799C14.949 9.878 14.757 9.945 14.572 9.953C14.284 9.968 13.972 9.851 13.802 9.709C13.537 9.487 13.348 9.363 13.27 8.977C13.236 8.812 13.255 8.556 13.284 8.41C13.352 8.094 13.277 7.892 13.055 7.708C12.873 7.558 12.643 7.516 12.39 7.516C12.296 7.516 12.209 7.475 12.145 7.441C12.039 7.389 11.952 7.257 12.035 7.096C12.062 7.043 12.19 6.916 12.22 6.893C12.563 6.698 12.96 6.762 13.326 6.908C13.665 7.047 13.922 7.302 14.292 7.663C14.669 8.098 14.738 8.218 14.953 8.545C15.123 8.801 15.277 9.063 15.383 9.364C15.447 9.551 15.364 9.705 15.142 9.799Z";
    function RobotIcon() {
      return h('svg', { className: 'ay-yuan-whale', width: 26, height: 26, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 16, cy: 16, r: 15, fill: '#eaf2ff' }),
        h('path', { d: YUAN_WHALE_PATH, transform: 'translate(4 8) scale(.96)', fill: '#4f7cf7' }),
        h('path', { d: 'M25 2.5 26.1 5.4 29 6.5 26.1 7.6 25 10.5 23.9 7.6 21 6.5 23.9 5.4Z', fill: '#ffc957', stroke: '#fff', strokeWidth: .7 }));
    }

    // Capture on pointer-down: clicking a control may otherwise collapse selection.
    // Only the selected excerpt / visible content is sampled, never the whole DOM or draft.

    let lastMainTarget = null;
    function captureOrigin(props = {}, details = true) {
      const sessionId = props.panelId ? null : props.sessionId || [...document.querySelectorAll('[data-conversation-session]')].find(n => !n.closest('.ay-yuan-float'))?.dataset.conversationSession || null;
      const row = sessionId ? clientService('sessions')?.list?.getSnapshot?.()?.byId?.[sessionId] : null;
      const origin = { sessionId, cwd: row?.cwd || props.cwd || '', location: props.location || (sessionId ? 'DSH 会话' : document.querySelector('.ls-page') ? 'Leo 待办' : 'DSH 页面'),
        route: props.panelId || 'conversation', running: row?.running === true,
        title: row?.displayTitle || row?.title || (sessionId ? '当前会话' : props.panelId || document.title),
        selection: details ? String(window.getSelection?.() || '').slice(0, 1800) : '' };
      const target = lastMainTarget?.isConnected && !lastMainTarget.closest('[hidden],[aria-hidden="true"]') ? lastMainTarget : null;
      const rightPane = target?.closest('[data-sidebar-right-session] [data-dockkit-pane], [data-sidebar-right-session] [data-dockkit-float]');
      const pane = target?.closest('[data-conversation-session],main,[role=main],[role=tabpanel]');
      const selectedSession = pane?.closest('[data-conversation-session]')?.dataset.conversationSession;
      if (selectedSession) { const selected = clientService('sessions')?.list?.getSnapshot?.()?.byId?.[selectedSession]; Object.assign(origin, { sessionId: selectedSession, title: selected?.displayTitle || selected?.title || origin.title, cwd: selected?.cwd || '', location: 'DSH 会话', route: 'conversation' }); }
      if (rightPane) {
        const tab = rightPane.querySelector('[role="tab"][aria-selected="true"], [data-dockkit-float-title]');
        Object.assign(origin, { location: 'DSH 右侧面板', route: 'sidebar.right', title: (tab?.textContent || '文件 / 面板').trim().slice(0,180) });
      }
      origin.secondary = [...document.querySelectorAll('[role=tab][aria-selected=true]')].filter(n => !n.closest('.ay-yuan-float')).map(n => n.textContent).join(' · ').slice(0,240);
      if (!details) return origin;
      const root = rightPane || document.querySelector('.ls-page') || [...document.querySelectorAll('[data-conversation-content]')].find(n => !n.closest('.ay-yuan-float')) || document.querySelector('main') || document.querySelector('[role="main"]');
      if (!root) return origin;
      origin.page = [...root.querySelectorAll('h1,h2,[role="tab"][aria-selected="true"]')].slice(0, 5).map((n) => n.textContent).join(' · ').slice(0, 350);
      const visible = (node) => { const r = node.getBoundingClientRect(); return r.width > 80 && r.height > 60 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; };
      origin.code = [...root.querySelectorAll('pre')].filter(visible).slice(0, 1).map((n) => n.textContent.slice(0, 1000)).join('');
      const picture = [...root.querySelectorAll('img')].find((n) => visible(n) && n.naturalWidth >= 160 && n.naturalHeight >= 100 && !n.closest('nav,header,.ay-yuan-native,[data-composer-seat]'));
      if (picture) {
        try {
          const scale = Math.min(1, 640 / Math.max(picture.naturalWidth, picture.naturalHeight));
          const canvas = document.createElement('canvas'); canvas.width = Math.round(picture.naturalWidth * scale); canvas.height = Math.round(picture.naturalHeight * scale);
          canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL('image/jpeg', .65); if (data.length <= 180000) origin.image = data;
        } catch { origin.page += picture.alt ? ' · 图片：' + picture.alt.slice(0, 200) : ''; }
      }
      return origin;
    }


    /**
     * 宿主用 completionUnread 标记「后台跑完、还没在主界面看过」的会话（左侧会话行的小圆点）。
     * 阿源浮框不是主界面，读过的会话不会自动清除；这里在浮框显示该会话时替宿主标记为已读。
     * 宿主没有公开 API，按当前客户端实现做特性检测；实现变化时静默降级（不崩，只是点可能还在）。
     */
    /** 宿主当前的正文基准字号（px）；百分比设置以它为 100%，跟随 DSH 字号设置。 */
    function hostContentFontSize() {
      try {
        const raw = getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size');
        const value = parseFloat(raw);
        return Number.isFinite(value) && value >= 10 && value <= 22 ? value : 14;
      } catch {
        return 14;
      }
    }

    function markFloatSessionRead(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      try {
        const uiSession = clientService('uiSession');
        const unread = uiSession?.completionUnread;
        if (!(unread instanceof Set) || !unread.has(sessionId)) return;
        // 没有发布能力时别只删集合，否则状态快照会停在旧值。
        if (typeof uiSession.publishStatus !== 'function') return;
        unread.delete(sessionId);
        uiSession.publishStatus();
      } catch {
        /* 宿主内部实现变了：保持原样 */
      }
    }

    const floating = { state: { sessionId: null, visible: false, source: null }, listeners: new Set(),
      set(value) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(this.state); } };
    function useFloating() {
      const [value, setValue] = useState(floating.state);
      useEffect(() => { floating.listeners.add(setValue); setValue(floating.state); return () => floating.listeners.delete(setValue); }, []);
      return value;
    }
    /**
     * 新会话欢迎页使用一个真实的空白阿源会话，正文与输入框都交给宿主原生 Composer：
     * 语音输入等输入区插件贡献的控件会自动出现，不需要插件逐个适配。
     */
    let draftOpening = null;
    /** 等宿主会话列表至少完成一次拉取，避免冷启动时把「还没到位」误判成「没有空白会话」。 */
    async function readySessionList() {
      const store = clientService('sessions')?.list;
      if (!store || typeof store.getSnapshot !== 'function') return null;
      let snapshot = store.getSnapshot();
      const deadline = Date.now() + 1200;
      while (snapshot !== undefined && snapshot !== null && snapshot.phase !== 'ready' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        snapshot = store.getSnapshot();
      }
      return snapshot;
    }
    async function openDraftYuan(options = {}) {
      if (draftOpening !== null) return draftOpening;
      const origin = options.origin || captureOrigin();
      draftOpening = (async () => {
        let state = yuan.state;
        if (state === null) state = await yuan.load().catch(() => null);
        if (state === null && yuan.loading === true) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          state = yuan.state;
        }
        const list = await readySessionList();
        const rows = list?.byId || {};
        // 主界面正在显示的空白会话不要抢：否则浮框会走「同会话双开」分支，又回到没有原生输入区。
        const blank = (state?.sessions || []).find((item) => {
          const row = item?.id ? rows[item.id] : undefined;
          return row?.blank === true && (row.retainedBy?.mainView || 0) === 0;
        });
        if (blank) {
          try {
            const result = await openYuan({ sessionId: blank.id, origin });
            if (result?.sessionId !== blank.id) throw new Error('空白会话打开失败，请再试一次');
            return result;
          } catch (error) {
            console.warn('[ayuan] blank session open failed; creating a new one', error);
          }
        }
        return openYuan({ newSession: true, origin });
      })();
      try { return await draftOpening; } finally { draftOpening = null; }
    }
    async function openYuan(options = {}) {
      if (options.draft === true) return openDraftYuan(options);
      if (!options.sessionId && !options.commit && !options.newSession) {
        floating.set({ sessionId: null, visible: true, source: options.origin || floating.state.source });
        return { draft: true };
      }
      if (options.newSession && floating.state.source && !options.origin) options = { ...options, origin: captureOrigin() };
      const result = await apiJson('/ayuan/api/open', { method: 'POST', body: options });
      if (result.remote) throw new Error('阿源位于中心设备，请在设备中心切换到中心设备后打开原生会话');
      yuan.set({ state: { ...(yuan.state || {}), sessions: result.sessions, context: result.context, contextSessionId: result.sessionId, mode: result.mode || null } });
      if (!options.deferDisplay) floating.set({ sessionId: result.sessionId, visible: true, ...(options.origin ? { source: options.origin } : {}) });
      return result;
    }

    const FLOAT_LAYOUT_KEY = 'ayuan.float-layout.v1';
    function clampFloat(layout) {
      const width = Math.max(Math.min(360, innerWidth - 16), Math.min(Number(layout?.width) || 620, innerWidth - 16));
      const height = Math.max(Math.min(300, innerHeight - 56), Math.min(Number(layout?.height) || 720, innerHeight - 56));
      return { width, height, x: Math.max(8, Math.min(Number.isFinite(layout?.x) ? layout.x : innerWidth - width - 24, innerWidth - width - 8)),
        y: Math.max(40, Math.min(Number.isFinite(layout?.y) ? layout.y : innerHeight - height - 24, innerHeight - height - 8)) };
    }
    function readFloatLayout() { try { return clampFloat(JSON.parse(localStorage.getItem(FLOAT_LAYOUT_KEY))); } catch { return clampFloat(null); } }
    // Store relative position once; resizing only changes its projection.
    const BUBBLE_POSITION_KEY = 'ayuan.bubble-position.v2';
    const clampUnit = n => Math.max(0, Math.min(1, Number(n) || 0));
    function bubbleSize() { return window.matchMedia?.('(pointer:coarse)').matches ? 44 : 42; }
    function savedBubble(position, snap=false) {
      const size=bubbleSize(),x=Math.max(0,Math.min(position.x,innerWidth-size)),y=Math.max(40,Math.min(position.y,innerHeight-size-8));
      return {rx:clampUnit((x-8)/Math.max(1,innerWidth-size-16)),ry:clampUnit((y-40)/Math.max(1,innerHeight-size-48)),dock:snap?(x<28?'left':x>innerWidth-size-28?'right':null):null};
    }
    function readBubblePosition() { try { const p=JSON.parse(localStorage.getItem(BUBBLE_POSITION_KEY));if(Number.isFinite(p?.rx)&&Number.isFinite(p?.ry))return p;const old=JSON.parse(localStorage.getItem('ayuan.bubble-position.v1'));return Number.isFinite(old?.x)&&Number.isFinite(old?.y)?savedBubble(old):null } catch {return null} }
    function projectBubble(position, expanded=false) {
      const size=bubbleSize(),p=position||{rx:1,ry:1},dock=['left','right'].includes(p.dock)?p.dock:null;
      const y=Math.max(40,Math.min(innerHeight-size-8,40+clampUnit(p.ry)*Math.max(1,innerHeight-size-48)));
      const x=dock==='left'?(expanded?8:-size/2):dock==='right'?(expanded?innerWidth-size-8:innerWidth-size/2):position?8+clampUnit(p.rx)*Math.max(0,innerWidth-size-16):innerWidth-size-24;
      return {x,y:position?y:innerHeight-size-24,width:size,height:size,dock,expanded};
    }

    function YuanChatView(props) {
      const [view, setView] = useState(() => { try { return localStorage.getItem('ayuan.float-view') === 'trajectory' ? 'trajectory' : 'chat'; } catch { return 'chat'; } });
      return h(React.Fragment, null,
        h('div', { className: 'ay-yuan-view-tabs', role: 'tablist', 'aria-label': '阿源会话视图' }, [['chat','对话'],['trajectory','轨迹']].map(([id,label]) => h('button', {
          key: id, role: 'tab', 'aria-selected': view === id, onClick: () => { setView(id); try { localStorage.setItem('ayuan.float-view', id); } catch {} },
        }, label))), props.renderSlot('conversation.session', { view }));
    }

    function YuanEmbeddedChat(props) {
      const t = typeof props.t === 'function' ? props.t : boundT;
      const session = typeof props.useSession === 'function' ? props.useSession((snapshot) => snapshot) : undefined;
      // 空白会话不再自绘输入框：欢迎内容占正文区，输入框用宿主原生 Composer，
      // 这样语音输入等输入区插件会随宿主自动出现，也不会把首条消息写进上一个会话。
      // 只有已加载的会话快照才认定为空白；快照未就绪时沿用普通会话视图，避免历史会话闪一下欢迎页。
      const blank = session !== undefined && session !== null && session.blank === true && session.openState !== 'loading';
      const onSend = typeof props.onSend === 'function' ? props.onSend : undefined;
      const views = useMemo(() => {
        if (!blank) return YuanChatView;
        return function YuanBlankView() {
          return h(AyLanding, { t, welcomeOnly: true, onSend });
        };
      }, [blank, onSend, t]);
      return props.renderFactorySlot('conversation.content', {
        variant: 'embedded', phase: session !== undefined && session !== null && session.openState === 'loading' ? 'settling' : 'active', hero: false,
      }, { slots: { views } });
    }

    function YuanFloatingPanel({ SessionProvider, renderSlot, renderFactorySlot, usePanelInfo, useSessions }) {
      const panelId = usePanelInfo(info => info.activePanelId);
      const mainSession = useSessions(snapshot => Object.values(snapshot.byId).find(row => (row.retainedBy.mainView || 0) > 0));
      const state = useFloating();
      const store = useYuanStore();
      const identity = store.state?.mode === 'hub' ? '中心设备 · 记忆在中心'
        : store.state?.mode === 'device' ? '本机运行 · 记忆同步中心'
        : '独立记忆 · 全权限';
      const [reference, setReference] = useState(null), [error, setError] = useState('');
      // 稳定引用，避免每次 render 换 onSend 导致欢迎页子树重挂、chip 发送状态丢失。
      const sendDraftMessage = useCallback(async (prompt) => {
        const text = String(prompt === undefined ? '' : prompt).trim();
        if (text === '' || reference === null) return;
        await reference.ready;
        const result = await reference.binding.session.prompt([{ type: 'text', text }], 'queue');
        if (!result.ok) throw new Error(result.error?.message || '发送失败');
      }, [reference]);
      const [geometry, setGeometry] = useState(readFloatLayout), [wide, setWide] = useState(false), [, setViewport] = useState(0);
      const [bubblePos, setBubblePos] = useState(readBubblePosition);
      const [dockExpanded,setDockExpanded]=useState(false), dockTimer=useRef();
      const revealDock = () => { clearTimeout(dockTimer.current);setDockExpanded(true); };
      const hideDock = () => { clearTimeout(dockTimer.current);dockTimer.current=setTimeout(()=>setDockExpanded(false),600); };
      const bubblePoint=projectBubble(bubblePos,dockExpanded);
      useEffect(()=>{const reveal=e=>e.detail?.active?revealDock():hideDock();const move=e=>{const p=e.detail;if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))setBubblePos(savedBubble(p,!!p.end));};window.addEventListener('leo-quick:dock-reveal-v1',reveal);window.addEventListener('leo-quick:launcher-move-v1',move);return()=>{clearTimeout(dockTimer.current);window.removeEventListener('leo-quick:dock-reveal-v1',reveal);window.removeEventListener('leo-quick:launcher-move-v1',move);};},[]);
      useEffect(() => {
        const publish = () => { const p = projectBubble(bubblePos,dockExpanded); window.dispatchEvent(new CustomEvent('ayuan:launcher-anchor-v1', { detail: { visible: !state.visible, panelOpen: !!state.visible, ...p } })); };
        window.addEventListener('leo-quick:anchor-request-v1', publish); window.addEventListener('resize', publish); publish();
        return () => { window.removeEventListener('leo-quick:anchor-request-v1', publish); window.removeEventListener('resize', publish); };
      }, [bubblePos, state.visible, dockExpanded]);
      useEffect(() => () => { window.dispatchEvent(new CustomEvent('ayuan:launcher-anchor-v1', {detail:{visible:false,panelOpen:false}})); }, []);

      const [settingsOpen, setSettingsOpen] = useState(false);
      const baseFontSize = hostContentFontSize();
      const [fontSizes, setFontSizes] = useState(() => { try { const saved = JSON.parse(localStorage.getItem('ayuan.font-sizes')); return { interface: [85,90,95,100].includes(saved?.interface) ? saved.interface : 95, reply: [75,80,85,90,100].includes(saved?.reply) ? saved.reply : 80 }; } catch { return { interface: 95, reply: 80 }; } });
      const updateFont = (key, value) => setFontSizes(old => { const next = { ...old, [key]: Number(value) }; try { localStorage.setItem('ayuan.font-sizes', JSON.stringify(next)); } catch {} return next; });
      const panel = useRef(null), drag = useRef(null), sizing = useRef(null), opener = useRef(null), previousSize = useRef(null);
      const bubbleDrag = useRef(null), suppressBubbleClick = useRef(false);
      const layout = clampFloat(geometry);
      useEffect(() => { try { localStorage.setItem(FLOAT_LAYOUT_KEY, JSON.stringify(geometry)); } catch {} }, [geometry]);
      useEffect(() => {
        if (!state.sessionId) return;
        let alive = true;
        const ref = clientService('sessions').retain(state.sessionId, { source: 'leoYuanFloat' });
        setReference(ref); setError('');
        ref.ready.catch(e => { if (alive) setError(e.message); });
        return () => { alive = false; ref.release(); };
      }, [state.sessionId]);
      useEffect(() => {
        if (state.visible) opener.current = document.activeElement;
        else opener.current?.focus?.();
      }, [state.visible]);
      // 浮框正在显示这个会话就算读过：清掉宿主左侧会话行的「后台完成未读」圆点，
      // 并在这个会话下一次后台跑完时继续清（订阅宿主状态源）。
      useEffect(() => {
        if (!state.visible || !state.sessionId) return undefined;
        const sessionId = state.sessionId;
        markFloatSessionRead(sessionId);
        const status = clientService('uiSession')?.sessionStatus;
        if (!status || typeof status.subscribe !== 'function') return undefined;
        return status.subscribe(() => markFloatSessionRead(sessionId));
      }, [state.visible, state.sessionId]);
      useEffect(() => {
        const onResize = () => { setViewport(n => n + 1); };
        window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize);
      }, []);
      useEffect(() => { if (!bubblePos) return; try { localStorage.setItem(BUBBLE_POSITION_KEY, JSON.stringify(bubblePos)); } catch {} }, [bubblePos]);
      // Metadata only: no model request, disk write, history scan or image capture.
      useEffect(() => {
        let timer;
        lastMainTarget = null;
        const update = () => { clearTimeout(timer); timer = setTimeout(() => {
          const origin = captureOrigin({ panelId, sessionId: panelId ? null : mainSession?.id }, false);
          floating.set({ source: origin });
          void apiJson('/ayuan/api/snapshot/update', { method: 'POST', body: origin }).catch(() => {});
        }, 180); };
        const track = e => { if (e.target.closest?.('.ay-yuan-float,.ay-yuan-bubble,.ay-yuan-launch,[data-ayuan-ignore-origin]')) return; lastMainTarget = e.target; update(); };
        document.addEventListener('pointerdown', track, true); document.addEventListener('focusin', track, true);
        const heartbeat = setInterval(update, 30000); update();
        return () => { clearTimeout(timer); clearInterval(heartbeat); document.removeEventListener('pointerdown', track, true); document.removeEventListener('focusin', track, true); };
      }, [panelId, mainSession?.id, mainSession?.displayTitle, mainSession?.running]);
      const begin = async () => {
        if (state.sessionId) { floating.set({ visible: true }); return; }
        const origin = captureOrigin();
        // 先显示浮框，再在后台准备空白会话（创建/恢复 Agent 可能需要一点时间）。
        floating.set({ visible: true, opening: true, source: origin });
        try { await openYuan({ draft: true, origin }); }
        catch (error) { setError(error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)); }
        finally { floating.set({ opening: false }); }
      };
      const updateOrigin = () => {
        const main = [...document.querySelectorAll('[data-conversation-session]')].find(n => !n.closest('.ay-yuan-float'));
        const origin = captureOrigin({ panelId, sessionId: panelId ? null : main?.dataset.conversationSession });
        floating.set({ source: origin });
        void apiJson('/ayuan/api/snapshot/update', { method: 'POST', body: origin }).catch(e => setError(e.message));
        if (state.sessionId) void openYuan({ sessionId: state.sessionId, origin }).catch(e => setError(e.message));
      };
      return h(React.Fragment, null,
        !state.visible ? h('button', {
          type: 'button', className: 'ay-yuan-bubble', title: '展开阿源（可拖动）', 'aria-label': '展开阿源',
          style: { left: bubblePoint.x, top: bubblePoint.y, width:bubblePoint.width,height:bubblePoint.height, right: 'auto', bottom: 'auto' },
          onPointerEnter:revealDock,onPointerLeave:hideDock,onFocus:revealDock,onBlur:hideDock,
          onPointerDown: e => {
            if (e.button !== 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            bubbleDrag.current = { startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height, moved: false };
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
          },
          onPointerMove: e => {
            const start = bubbleDrag.current;
            if (!start) return;
            if (!start.moved && Math.hypot(e.clientX - start.startX, e.clientY - start.startY) < 4) return;
            start.moved = true;
            start.last={x:e.clientX-start.dx,y:e.clientY-start.dy};setBubblePos(savedBubble(start.last));
          },
          onPointerUp: () => {
            if (bubbleDrag.current?.moved) { setBubblePos(savedBubble(bubbleDrag.current.last,true));hideDock();suppressBubbleClick.current = true; setTimeout(() => { suppressBubbleClick.current = false; }, 0); }
            bubbleDrag.current = null;
          },
          onPointerCancel: () => { bubbleDrag.current = null; },
          onLostPointerCapture: () => { bubbleDrag.current = null; },
          onClick: () => {
            if (suppressBubbleClick.current) { suppressBubbleClick.current = false; return; }
            void begin();
          },
        }, h(RobotIcon)) : null,
        h('section', { ref: panel, className: 'ay-yuan-float' + (wide ? ' ay-yuan-float-wide' : ''), role: 'dialog', 'aria-modal': false, 'aria-label': '阿源浮框',
          style: { display: state.visible ? 'flex' : 'none', left: layout.x, top: layout.y, width: layout.width, height: layout.height, right: 'auto', bottom: 'auto', maxWidth: 'none', maxHeight: 'none' },
          onKeyDown: e => { if (e.key === 'Escape' && !e.defaultPrevented) { if (settingsOpen) setSettingsOpen(false); else floating.set({ visible: false }); e.stopPropagation(); } } },
          h('header', { className: 'ay-yuan-float-head', onPointerDown: e => {
            if (e.button !== 0 || e.target.closest('button')) return;
            const r = panel.current.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
          }, onPointerMove: e => { if (!drag.current) return; setGeometry(clampFloat({ ...layout, x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })); },
          onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } },
            h('div', { className: 'ay-yuan-float-identity' }, h(RobotIcon), h('strong', null, '阿源'), h('span', null, identity)),
            h('button', { className: 'ay-yuan-btn', onPointerDown: e => { e.preventDefault(); }, onClick: updateOrigin, title: '携带当前页面、选中文字或代码' }, '更新位置'),
            h('button', { className: 'ay-yuan-btn', onClick: () => { setGeometry(clampFloat(null)); setWide(false); }, title: '重置浮框大小和位置' }, '重置'),
            h('button', { className: 'ay-yuan-btn', onClick: () => { if (!wide) { previousSize.current = geometry; setGeometry(clampFloat({ width: 940, height: 850 })); } else setGeometry(previousSize.current || clampFloat(null)); setWide(!wide); }, 'aria-label': wide ? '缩小浮框' : '放大浮框' }, wide ? '↙' : '↗'),
            h('button', { className: 'ay-yuan-btn ay-header-icon', onClick: () => setSettingsOpen(v => !v), title: '阿源设置', 'aria-label': '阿源设置', 'aria-expanded': settingsOpen }, h('svg', {width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true}, h('circle',{cx:12,cy:12,r:3}), h('path',{d:'M9.7 3.2 10.3 2h3.4l.6 1.2.3 1.4 1.2.5 1.2-.8 1.3-.4 2.4 2.4-.4 1.3-.8 1.2.5 1.2 1.4.3 1.2.6v3.4l-1.2.6-1.4.3-.5 1.2.8 1.2.4 1.3-2.4 2.4-1.3-.4-1.2-.8-1.2.5-.3 1.4-.6 1.2h-3.4l-.6-1.2-.3-1.4-1.2-.5-1.2.8-1.3.4-2.4-2.4.4-1.3.8-1.2-.5-1.2-1.4-.3L2 13.7v-3.4l1.2-.6 1.4-.3.5-1.2-.8-1.2-.4-1.3 2.4-2.4 1.3.4 1.2.8 1.2-.5z',strokeLinejoin:'round'}))),
            h('button', { className: 'ay-yuan-btn ay-header-icon', onClick: () => floating.set({ visible: false }), title: '收起阿源', 'aria-label': '收起阿源' }, h('svg', {width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true}, h('path',{d:'M5 12h14'})))),
          settingsOpen ? h('section', {className:'ay-settings', 'aria-label':'阿源设置'}, h('div', {className:'ay-settings-head'}, h('strong',null,'阿源设置'), h('button',{className:'ay-yuan-btn',onClick:()=>setSettingsOpen(false),'aria-label':'关闭设置'},'×')), h('p',null,'浮框字号'), [['interface','输入和界面文字',[85,90,95,100]],['reply','阿源回复正文',[75,80,85,90,100]]].map(([key,label,choices])=>h('label',{key},h('span',null,label),h('select',{value:fontSizes[key],onChange:e=>updateFont(key,e.target.value)},choices.map(n=>h('option',{key:n,value:n},n+'%'))))), h('div',{className:'ay-settings-preview','aria-hidden':true},h('span',{style:{fontSize:(baseFontSize*fontSizes.interface/100)+'px'}},'输入和界面文字 '+fontSizes.interface+'%'),h('span',{style:{fontSize:(baseFontSize*fontSizes.reply/100)+'px'}},'阿源回复正文 '+fontSizes.reply+'%')), h('small',null,'设置保存在此设备，改动即时生效。')) : null,
          h(YuanNativeTools, { sessionId: state.sessionId, floating: true, renderFactorySlot }),
          error ? h('p', { role: 'alert', className: 'ay-native-error' }, error) : null,
          h('div', { className: 'ay-yuan-float-body', style: { '--ay-interface-font': (baseFontSize * fontSizes.interface / 100) + 'px', '--ay-interface-delta': (baseFontSize * fontSizes.interface / 100 - baseFontSize) + 'px', '--ay-reply-font': (baseFontSize * fontSizes.reply / 100) + 'px', '--ay-reply-delta': (baseFontSize * fontSizes.reply / 100 - baseFontSize) + 'px' } }, !state.visible ? null : state.opening && !state.sessionId ? h('div', { className: 'ay-landing' }, h('div', { className: 'ay-landing__mark' }, h(RobotIcon)), h('p', { className: 'ay-landing__hint' }, '正在打开阿源…')) : !state.sessionId ? h(AyLanding, { t: boundT, onSend: async prompt => {
            const result = await openYuan({ commit: true, deferDisplay: true, newSession: true, origin: captureOrigin() });
            const ref = clientService('sessions').retain(result.sessionId, { source: 'leoYuanFloat' });
            try { const binding = await ref.ready; const outcome = await binding.session.prompt([{ type: 'text', text: prompt }], 'queue'); if (!outcome.ok) throw new Error(outcome.error?.message || '发送失败'); floating.set({ sessionId: result.sessionId, visible: true }); }
            finally { ref.release(); }
          } }) : !panelId && mainSession?.id === state.sessionId ? h(AyLanding, { t: boundT, sameSession: true, onSend: async prompt => {
            await reference.ready; const result = await reference.binding.session.prompt([{ type: 'text', text: prompt }], 'queue');
            if (!result.ok) throw new Error(result.error?.message || '发送失败');
          } }) : reference?.sessionId === state.sessionId ? h(SessionProvider, { session: reference }, renderSlot('ayuan.conversation', { onSend: sendDraftMessage })) : h('p', null, '正在连接阿源…')),
          h('footer', { className: 'ay-yuan-float-foot' }, '拖动标题栏移动 · 右下角缩放'),
          h('button', { className: 'ay-yuan-resize', 'aria-label': '调整浮框大小', title: '拖动调整大小；方向键微调',
            onPointerDown: e => { e.preventDefault(); e.currentTarget.focus(); sizing.current = { startX: e.clientX, startY: e.clientY, ...layout }; e.currentTarget.setPointerCapture(e.pointerId); },
            onPointerMove: e => { const s = sizing.current; if (s) setGeometry(clampFloat({ ...s, width: s.width + e.clientX - s.startX, height: s.height + e.clientY - s.startY })); },
            onPointerUp: () => { sizing.current = null; }, onLostPointerCapture: () => { sizing.current = null; },
            onKeyDown: e => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); setGeometry(clampFloat({ ...layout, width: layout.width + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0), height: layout.height + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0) })); },
          }, h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M3 13 13 3M8 13 13 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))));
    }


    function YuanEntry(props) {
      const [busy, setBusy] = useState(false), [error, setError] = useState('');
      const snapshot = useRef(null);
      const store = useYuanStore();
      const isYuan = store.state?.sessions?.some((s) => s.id === props.sessionId);
      if (isYuan) return null;
      return h('span', { className: 'ay-yuan-launch' },
        h('button', { type: 'button', className: 'ay-yuan-entry', disabled: busy,
          title: '打开阿源 · 携带当前位置', 'aria-label': '打开阿源 · 携带当前位置',
          onPointerDown: () => { snapshot.current = captureOrigin(props); },
          onClick: async () => { setBusy(true); setError(''); try { await openYuan({ draft: true, origin: snapshot.current || captureOrigin(props) }); }
            catch (e) { setError(e.message); } finally { snapshot.current = null; setBusy(false); } } }, h(RobotIcon)),
        error ? h('span', { className: 'ay-native-error', role: 'alert', onClick: () => setError(''), title: '点击收起' }, error) : null);
    }


    function MemoryBrowser() {
      const [items, setItems] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState(null);
      const [editing, setEditing] = useState(null), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
      const generation = useRef(0);
      const load = async (value = query) => {
        const request = ++generation.current;
        try { const result = await apiJson('/ayuan/api/memory/query', { method: 'POST', body: { query: value } });
          if (request === generation.current) { setItems(result.items); setStatus(result.status); setError(''); } }
        catch (e) { if (request === generation.current) setError(e.message); }
      };
      useEffect(() => { const timer = setTimeout(() => load(query), 180); return () => { clearTimeout(timer); generation.current++; }; }, [query]);
      const change = async (item, action, text) => { setBusy(true); try {
        await apiJson('/ayuan/api/memory/change', { method: 'POST', body: { id: item.id, action, text } });
        setEditing(null); await load();
      } catch(e) { setError(e.message); } finally { setBusy(false); } };
      const kinds = { episode: '对话记录', preference: '偏好', fact: '事实', project: '项目', decision: '决定' };
      return h('div', { className: 'ay-memory-browser' },
        h('p', { className: 'ay-native-hint' }, '自动记录阿源对话，按当前问题检索。提炼保留原文依据；不确定的信息等待核对。'),
        h('div', { className: 'ay-toolbar__row' }, h('input', { className: 'ay-search__input', type: 'search', placeholder: '搜索记忆与对话…', 'aria-label': '搜索记忆与对话', value: query, onChange: (e) => setQuery(e.target.value) }),
          h('button', { className: 'ay-yuan-btn', onClick: () => load() }, '刷新')),
        error ? h('p', { className: 'ay-yuan-error', role: 'alert' }, error) : null,
        status?.lastError ? h('p', { className: 'ay-native-hint' }, '自动提炼暂不可用，原文仍可检索。') : null,
        status?.extracting ? h('p', { className: 'ay-native-hint' }, '正在整理新对话…') : null,
        items.length === 0 ? h('p', { className: 'ay-native-empty' }, query ? '没有相关记忆' : '与阿源对话后，记忆会自动出现在这里。') : null,
        items.map((item) => h('article', { className: 'ay-memory-row', key: item.id },
          h('div', { className: 'ay-native-hint' }, (kinds[item.kind] || '记忆') + (item.status === 'pending' ? ' · 待核对' : '') + ' · ' + new Date(item.at).toLocaleDateString()),
          editing === item.id ? h('textarea', { className: 'ay-memory-edit', value: draft, onChange: (e) => setDraft(e.target.value), 'aria-label': '修正记忆' }) : h('p', null, item.text),
          h('details', null, h('summary', null, '原文依据'), h('blockquote', null, item.source?.quote || '来自旧版记忆'),
            item.source?.sessionId ? h('button', { className: 'ay-yuan-btn', onClick: () => clientService('uiWorkspace')?.openSession(item.source.sessionId) }, '打开来源会话') : null),
          h('div', { className: 'ay-yuan-actions' },
            item.status === 'pending' ? h('button', { className: 'ay-yuan-btn', disabled: busy, onClick: () => change(item, 'accept') }, '确认') : null,
            editing === item.id ? h(React.Fragment, null, h('button', { className: 'ay-yuan-btn', disabled: busy || !draft.trim(), onClick: () => change(item, 'correct', draft) }, '保存修正'),
              h('button', { className: 'ay-yuan-btn', onClick: () => setEditing(null) }, '取消')) : h('button', { className: 'ay-yuan-btn', onClick: () => { setEditing(item.id); setDraft(item.text); } }, '纠正'),
            h('button', { className: 'ay-yuan-btn', disabled: busy, onClick: () => change(item, 'forget') }, '忘记')))));
    }


    function relativeTime(value) {
      const ms = Date.now() - new Date(value).getTime();
      if (!Number.isFinite(ms)) return '';
      const minutes = Math.max(0, Math.floor(ms / 60000));
      return minutes < 1 ? '刚刚' : minutes < 60 ? minutes + '分钟' : minutes < 1440 ? Math.floor(minutes / 60) + '小时' : Math.floor(minutes / 1440) + '天';
    }

    /** 会话悬停卡片内容：标题、相对时间、宿主 sidebar.session.row.hover 扩展点、运行状态。 */
    function YuanHistoryHover({ owner, title, time, native, renderSlot }) {
      const running = native?.running === true;
      const dot = StateDot ? h(StateDot, { state: running ? 'ongoing' : 'idle' }) : h('span', { className: 'ay-history-dot' });
      return h('div', { className: 'ay-history-hover' },
        h('div', { className: 'ay-history-hover-title' }, title),
        time ? h('div', { className: 'ay-history-hover-time' }, time === '刚刚' ? '刚刚更新' : time + '前更新') : null,
        h('div', { className: 'ay-history-hover-extra' }, renderSlot('ayuan.history.hover', owner)),
        h('div', { className: 'ay-history-hover-status' }, dot, h('span', null, running ? '运行中' : '空闲')));
    }

    /**
     * 仿照宿主左侧会话行：行骨架按原生度量（32px/14px/10px、悬停换成操作按钮），
     * 前导装饰、菜单项、悬停按钮、悬停卡片扩展全部走宿主 slot 的镜像副本。
     */
    function YuanHistoryRow({ row, navigate, renderSlot }) {
      const [menu, setMenu] = useState(false);
      // hookContext 需要稳定身份；useState 每次返回新数组会让宿主菜单钩子反复重绑。
      const menuState = useMemo(() => [menu, setMenu], [menu]);
      const native = clientService('sessions')?.list?.getSnapshot?.()?.byId?.[row.id];
      const title = native?.displayTitle || row.title || row.id;
      const owner = { sessionId: row.id, displayTitle: title };
      const time = relativeTime(native?.updatedAt || row.lastActiveAt || row.createdAt);
      const open = () => navigate({ sessionId: row.id });
      const leading = native?.running === true
        ? (StateDot ? h(StateDot, { state: 'ongoing' }) : h('span', { className: 'ay-history-dot' }))
        : renderSlot('ayuan.history.leading', owner);
      const rowNode = h('div', {
        className: 'ay-history-item' + (menu ? ' is-menu-open' : ''),
        role: 'treeitem',
        'aria-selected': false,
        tabIndex: 0,
        'data-row-key': 'session:' + row.id,
        onClick: open,
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } },
      },
        h('span', { className: 'ay-history-leading' }, leading),
        h('span', { className: 'ay-history-title' }, title),
        h('span', { className: 'ay-history-time' }, time),
        h('span', { className: 'ay-history-native-actions', onClick: (event) => event.stopPropagation() },
          h(Menu, {
            open: menu,
            onClose: () => setMenu(false),
            portal: true,
            closeOnPointerLeave: true,
            anchor: h('button', {
              type: 'button', className: 'ay-history-more', 'aria-label': '会话操作', 'aria-expanded': menu,
              onClick: () => setMenu((value) => !value),
            }, h(IconEllipsisOutlineRegular, {})),
          }, renderSlot('ayuan.history.menu', owner, { hookContext: menuState })),
          renderSlot('ayuan.history.actions', owner)));
      if (!HoverCard) return rowNode;
      return h(HoverCard, {
        anchor: rowNode,
        content: h(YuanHistoryHover, { owner, title, time, native, renderSlot }),
        openDelayMs: 800,
        grouped: true,
        disabled: menu,
        copyText: title,
        copyLabel: '复制标题',
        copiedLabel: '已复制',
      });
    }

    // 复用宿主左侧会话行的公开扩展点：组件、注入动作和 locale 都按源 slot 原样镜像。
    // 宿主或第三方插件往这些 slot 里新增条目时，阿源历史列表会跟着更新。
    function installNativeHistory(ctx) {
      const mirrors = [
        ['sidebar.workspaces.session.menu.item', 'ayuan.history.menu'],
        ['sidebar.workspaces.session.row.action', 'ayuan.history.actions'],
        ['sidebar.session.row.leading', 'ayuan.history.leading'],
        ['sidebar.session.row.hover', 'ayuan.history.hover'],
      ];
      return ctx.slots.inject(mirrors[0][0], () => {
        const menuSpec = ctx.slots.spec(mirrors[0][0]);
        const children = {
          'ayuan.history.menu': menuSpec?.inject === undefined ? { kind: 'list', scope: 'root' } : { kind: 'list', scope: 'root', inject: menuSpec.inject },
          'ayuan.history.actions': { kind: 'list', scope: 'root' },
          'ayuan.history.leading': { kind: 'list', scope: 'root' },
          'ayuan.history.hover': { kind: 'list', scope: 'root' },
        };
        const factory = ctx.slots.registerFactory({ name: 'ayuan.history.row', scope: 'root', children }, YuanHistoryRow);
        const cleanups = mirrors.map(([source, target]) => {
          let registrations = [];
          const sync = () => {
            registrations.forEach(dispose => dispose());
            registrations = ctx.slots.entriesOfSlot(source).map((entry, index) => ctx.slots.register({
              name: target, id: 'host-' + index, order: index, locale: entry.locale, inject: entry.inject,
            }, entry.component));
          };
          sync();
          const unsubscribe = ctx.slots.subscribe(source, sync);
          return () => { unsubscribe(); registrations.forEach(dispose => dispose()); };
        });
        return () => { cleanups.forEach(dispose => dispose()); factory(); };
      });
    }

    function YuanNativeTools(props) {
      const [snapshot, setSnapshot] = useState(null);
      const store = useYuanStore(), [panel, setPanel] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
      const root = useRef(null);
      useEffect(() => { store.load(); }, [props.sessionId]);
      useEffect(() => {
        if (!store.state?.context) return;
        const timer = setInterval(() => store.load(true), 5000);
        return () => clearInterval(timer);
      }, [store.state?.context]);
      useEffect(() => {
        if (!panel) return;
        const close = (e) => { if (e.key === 'Escape' || (e.type === 'pointerdown' && root.current && !root.current.contains(e.target) && !e.target.closest('[role=menu]'))) setPanel(''); };
        document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
        return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
      }, [panel]);
      const rows = clientService('sessions')?.list?.getSnapshot?.()?.byId || {};
      // 顺序也按宿主左侧列表的习惯：最近更新的在前（宿主 pinned/手动排序没有公开给插件，暂不复制）。
      const recency = (session) => {
        const host = rows[session.id]?.updatedAt;
        if (typeof host === 'number' && Number.isFinite(host)) return host;
        const parsed = Date.parse(session.lastActiveAt || session.createdAt || '');
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const sessions = (store.state?.sessions || [])
        .filter(s => rows[s.id]?.blank !== true && (rows[s.id] ? rows[s.id].blank === false : s.topicNamed === true))
        .sort((a, b) => recency(b) - recency(a));
      if (!props.floating && !sessions.some((s) => s.id === props.sessionId)) return null;
      const context = store.state?.contextSessionId === props.sessionId ? store.state?.context : null;
      const navigate = async (options) => { setBusy(true); setError(''); try { await openYuan(options); setPanel(''); }
        catch(e) { setError(e.message); } finally { setBusy(false); } };
      return h('div', { className: 'ay-yuan-native', ref: root },
        !props.floating ? h('span', { className: 'ay-native-name' }, h(RobotIcon), '阿源') : null,
        h('button', { className: 'ay-yuan-btn', disabled: busy, onClick: () => navigate({ draft: true }) }, '新会话'),
        h('button', { className: 'ay-yuan-btn', style: { marginLeft: 'auto', order: 99 }, title: '查看阿源 status 快照', 'aria-label': '查看阿源 status 快照', onClick: async () => { try { const result = await apiJson('/ayuan/api/snapshot'); setSnapshot(result.snapshot); setPanel('快照'); } catch(e) { setError(e.message); } } }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 3 }), h('path', { d: 'M8 8h8M8 12h5M8 16h8' }))),
        ['历史','记忆'].map((name) => h('button', { key: name, className: 'ay-yuan-btn', 'aria-expanded': panel === name, onClick: () => setPanel(panel === name ? '' : name) }, name)),
        context ? h('button', { className: 'ay-context-chip', onClick: () => setPanel(panel === '位置' ? '' : '位置'), title: '将在下一次发言时提供给阿源，10 分钟后过期' }, '来自 ' + (context.title || context.location)) : null,
        error ? h('span', { className: 'ay-native-error', role: 'alert' }, error) : null,
        panel ? h('section', { className: 'ay-native-popover ay-native-popover--' + (panel === '历史' ? 'history' : panel === '快照' ? 'snapshot' : 'default'), 'aria-label': '阿源' + panel },
          h('div', { className: 'ay-native-popover-head' }, h('strong', null, panel === '位置' ? '已携带的位置' : '阿源 · ' + panel), h('button', { className: 'ay-yuan-btn', onClick: () => setPanel(''), 'aria-label': '关闭阿源菜单' }, '×')),
          panel === '历史' ? sessions.length ? h('div', { className: 'ay-history-list', role: 'tree', 'aria-label': '阿源历史会话' }, sessions.map(s => h(React.Fragment, { key: s.id }, props.renderFactorySlot('ayuan.history.row', { row: s, navigate })))) : h('p', { className: 'ay-native-empty' }, '暂无历史会话，发送第一条消息后会显示在这里。') : null,
          panel === '快照' ? snapshot ? h('div', { className: 'ay-snapshot' },
            h('div', { className: 'ay-snapshot-status' }, h('span', { className: 'ay-snapshot-badge' + (snapshot.stale ? ' is-stale' : '') }, snapshot.stale ? '位置已过期' : '位置已同步'), h('span', null, relativeTime(snapshot.observedAt) + '更新')),
            h('div', { className: 'ay-snapshot-source' }, h('span', { className: 'ay-snapshot-eyebrow' }, snapshot.view.location || '当前界面'), h('h3', null, snapshot.view.title || '未命名界面'), h('span', { className: 'ay-snapshot-state' }, snapshot.view.running ? '会话运行中' : '会话空闲')),
            snapshot.view.secondary ? h('div', { className: 'ay-snapshot-field' }, h('span', null, '同时打开'), h('div', null, snapshot.view.secondary)) : null,
            snapshot.view.cwd ? h('div', { className: 'ay-snapshot-field' }, h('span', null, '工作目录'), h('div', { className: 'ay-snapshot-path' }, snapshot.view.cwd)) : null,
            snapshot.view.sessionId ? h('div', { className: 'ay-snapshot-field' }, h('span', null, '会话 ID'), h('div', { className: 'ay-snapshot-id' }, h('code', null, snapshot.view.sessionId), h('button', { className: 'ay-yuan-btn', onClick: () => copyToClipboard(snapshot.view.sessionId), title: '复制会话 ID' }, '复制'))) : null,
            h('p', { className: 'ay-snapshot-footnote' }, '最后同步 ' + new Date(snapshot.observedAt).toLocaleTimeString() + ' · 仅同步位置信息'),
            h('p', { className: 'ay-native-hint' }, snapshot.stale ? '点击主界面后重新打开快照，即可更新位置。' : '收起时也持续更新。正文与图片仅在需要时读取。')) : h('p', { className: 'ay-native-empty' }, '尚未获取位置，请先点击主界面。') : null,
          panel === '记忆' ? h(MemoryBrowser) : null,
          panel === '位置' ? h('div', null, h('p', { className: 'ay-native-hint' }, '点击入口时的快照；下一次发言时提供，不会自动发送消息。10 分钟后过期。'),
            h('p', null, context?.title || context?.location), h('p', null, context?.selection || context?.page || ''),
            context?.code ? h('pre', null, context.code) : null, context?.recent?.map((r, i) => h('blockquote', { key: i }, r.text)), context?.image ? h('p', null, '已携带一张缩略图片') : null) : null) : null);
    }


    function copyToClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(String(text ?? '')).catch(() => {});
          return true;
        }
      } catch {
        /* clipboard unavailable */
      }
      return false;
    }

    function CopyButton({ t, text, className }) {
      const [copied, setCopied] = useState(false);
      const label = copied ? t('yuanCopied') : t('yuanCopy');
      return h(
        'button',
        {
          type: 'button',
          className: 'ay-yuan-copy' + (typeof className === 'string' && className !== '' ? ' ' + className : ''),
          title: label,
          'aria-label': label,
          onClick: () => {
            copyToClipboard(text);
            setCopied(true);
            if (typeof setTimeout === 'function') setTimeout(() => setCopied(false), 1500);
          },
        },
        label,
      );
    }

    function sanitizeHref(value) {
      const href = typeof value === 'string' ? value.trim() : '';
      if (href === '') return null;
      if (/^(https?:|mailto:)/i.test(href) || href.startsWith('/') || href.startsWith('#')) return href;
      return null;
    }

    const YUAN_INLINE_PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

    /** Render a safe Markdown inline subset into React nodes (no innerHTML). */
    function renderInline(text) {
      const source = typeof text === 'string' ? text : '';
      if (source === '') return [];
      const tokens = source.split(YUAN_INLINE_PATTERN);
      const nodes = [];
      tokens.forEach((token, index) => {
        if (token === '') return;
        const key = 'in-' + index;
        if (/^\*\*[^*\n]+\*\*$/.test(token) || /^__[^_\n]+__$/.test(token)) {
          nodes.push(h('strong', { key }, renderInline(token.slice(2, -2))));
        } else if (/^\*[^*\n]+\*$/.test(token) || /^_[^_\n]+_$/.test(token)) {
          nodes.push(h('em', { key }, renderInline(token.slice(1, -1))));
        } else if (/^`[^`\n]+`$/.test(token)) {
          nodes.push(h('code', { key, className: 'ay-yuan-inline-code' }, token.slice(1, -1)));
        } else if (/^\[[^\]\n]+\]\([^)\s]+\)$/.test(token)) {
          const match = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token);
          const href = sanitizeHref(match === null ? '' : match[2]);
          if (href === null) nodes.push(token);
          else {
            nodes.push(
              h(
                'a',
                { key, href, target: '_blank', rel: 'noreferrer noopener', className: 'ay-yuan-link' },
                match[1],
              ),
            );
          }
        } else {
          nodes.push(token);
        }
      });
      return nodes;
    }

    function isMarkdownBlockStart(line) {
      return (
        /^\s*$/.test(line) ||
        /^\s*(```|~~~)/.test(line) ||
        /^\s*#{1,6}\s+/.test(line) ||
        /^\s*>/.test(line) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
        /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
      );
    }

    function CodeBlock({ t, code, language }) {
      const [copied, setCopied] = useState(false);
      const label = copied ? t('yuanCopied') : t('yuanCopyCode');
      const codeText = typeof code === 'string' ? code : '';
      return h(
        'div',
        { className: 'ay-yuan-code' },
        h(
          'div',
          { className: 'ay-yuan-code__head' },
          h('span', { className: 'ay-yuan-code__lang' }, typeof language === 'string' && language !== '' ? language : ''),
          h(
            'button',
            {
              type: 'button',
              className: 'ay-yuan-code-copy',
              title: label,
              'aria-label': label,
              onClick: () => {
                copyToClipboard(codeText);
                setCopied(true);
                if (typeof setTimeout === 'function') setTimeout(() => setCopied(false), 1500);
              },
            },
            label,
          ),
        ),
        h('pre', { className: 'ay-yuan-code__pre' }, h('code', null, codeText)),
      );
    }

    /** Block-level Markdown subset renderer (headings/lists/code/quotes/links/...). */
    function renderMarkdown(text, t) {
      const lines = String(text ?? '').split(/\r?\n/);
      const blocks = [];
      let index = 0;
      let key = 0;
      const nextKey = () => 'md-' + key++;
      while (index < lines.length) {
        const line = lines[index];
        if (/^\s*$/.test(line)) {
          index += 1;
          continue;
        }
        const fence = /^\s*(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
        if (fence !== null) {
          const marker = fence[1];
          const language = fence[2];
          const codeLines = [];
          index += 1;
          const close = new RegExp('^\\s*' + marker + '\\s*$');
          while (index < lines.length && !close.test(lines[index])) {
            codeLines.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          blocks.push(h(CodeBlock, { key: nextKey(), t, code: codeLines.join('\n'), language }));
          continue;
        }
        const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
        if (heading !== null) {
          const level = heading[1].length;
          const tag = level <= 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
          blocks.push(
            h(
              tag,
              { key: nextKey(), className: 'ay-yuan-md-heading ay-yuan-md-heading--' + level },
              renderInline(heading[2].trim()),
            ),
          );
          index += 1;
          continue;
        }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
          blocks.push(h('hr', { key: nextKey(), className: 'ay-yuan-md-hr' }));
          index += 1;
          continue;
        }
        if (/^\s*>/.test(line)) {
          const quoteLines = [];
          while (index < lines.length && /^\s*>/.test(lines[index])) {
            quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
            index += 1;
          }
          blocks.push(
            h('blockquote', { key: nextKey(), className: 'ay-yuan-md-quote' }, renderInline(quoteLines.join('\n'))),
          );
          continue;
        }
        if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
          const firstMatch = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
          const ordered = firstMatch !== null && /^\d/.test(firstMatch[2]);
          const items = [];
          while (index < lines.length) {
            const itemMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
            if (itemMatch === null) break;
            const indent = Math.min(3, Math.floor(itemMatch[1].replace(/\t/g, '  ').length / 2));
            const body = itemMatch[3];
            const task = /^\[([ xX])\]\s*(.*)$/.exec(body);
            let content;
            if (task !== null) {
              const checked = task[1] !== ' ';
              content = h(
                'span',
                { className: 'ay-yuan-task' + (checked ? ' ay-yuan-task--done' : '') },
                h(
                  'span',
                  { className: 'ay-yuan-task__box', 'aria-hidden': 'true' },
                  h(CheckIcon, { mode: checked ? 'done' : 'open' }),
                ),
                h('span', null, renderInline(task[2])),
              );
            } else {
              content = h('span', null, renderInline(body));
            }
            items.push(
              h(
                'li',
                {
                  key: nextKey(),
                  className: 'ay-yuan-md-li',
                  style: indent > 0 ? { marginLeft: indent * 14 + 'px' } : undefined,
                },
                content,
              ),
            );
            index += 1;
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey(), className: 'ay-yuan-md-list' }, items));
          continue;
        }
        const paragraphLines = [];
        while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
          paragraphLines.push(lines[index]);
          index += 1;
        }
        if (paragraphLines.length === 0) {
          index += 1;
          continue;
        }
        blocks.push(h('p', { key: nextKey(), className: 'ay-yuan-md-p' }, renderInline(paragraphLines.join('\n'))));
      }
      return blocks;
    }

    function MarkdownView({ t, text }) {
      return h('div', { className: 'ay-yuan-markdown' }, renderMarkdown(text, t));
    }

    const YUAN_TOOL_RESULT_LIMIT = 2000;

    /** One tool call card: name + argument summary + collapsible result. */
    function YuanToolCard({ t, tool }) {
      const [argsOpen, setArgsOpen] = useState(false);
      const [resultOpen, setResultOpen] = useState(false);
      const name =
        tool !== null && typeof tool === 'object' && typeof tool.name === 'string' && tool.name !== ''
          ? tool.name
          : t('toolCall');
      const isError = tool !== null && typeof tool === 'object' && tool.isError === true;
      const argsText = yuanToolArgumentsText(tool);
      const rawResult = yuanToolResultText(tool);
      const resultText =
        rawResult.length > YUAN_TOOL_RESULT_LIMIT
          ? rawResult.slice(0, YUAN_TOOL_RESULT_LIMIT) + '\u2026'
          : rawResult;
      const argsSummary = argsText.length > 120 ? argsText.slice(0, 117) + '\u2026' : argsText;
      const stateLabel = isError ? t('toolError') : resultText === '' ? t('toolPending') : t('toolResult');
      return h(
        'div',
        { className: 'ay-yuan-tool' + (isError ? ' ay-yuan-tool--error' : '') },
        h(
          'div',
          { className: 'ay-yuan-tool__head' },
          h(
            'span',
            { className: 'ay-yuan-tool__icon', 'aria-hidden': 'true' },
            h(
              'svg',
              { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
              h('path', {
                d: 'M10.6 2.4a2.9 2.9 0 0 0-3.2 3.9L2.8 10.9a1.4 1.4 0 0 0 2 2l4.6-4.6a2.9 2.9 0 0 0 3.9-3.2l-1.8 1.8-1.9-.4-.4-1.9 1.4-1.4z',
                stroke: 'currentColor',
                strokeWidth: 1.1,
                strokeLinejoin: 'round',
              }),
            ),
          ),
          h('span', { className: 'ay-yuan-tool__name' }, name),
          h('span', { className: 'ay-yuan-tool__state' }, stateLabel),
          argsText !== ''
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ay-yuan-tool__toggle ay-yuan-tool__toggle--args',
                  title: t('toolArgs'),
                  'aria-label': t('toolArgs'),
                  'aria-expanded': argsOpen ? 'true' : 'false',
                  onClick: () => setArgsOpen((value) => !value),
                },
                argsOpen ? t('toolCollapse') : t('toolExpand'),
              )
            : null,
        ),
        argsText !== ''
          ? h(
              'button',
              {
                type: 'button',
                className: 'ay-yuan-tool__args',
                title: argsText,
                onClick: () => setArgsOpen((value) => !value),
              },
              t('toolArgs') + ': ' + (argsOpen ? argsText : argsSummary),
            )
          : null,
        argsOpen && argsText !== '' ? h('pre', { className: 'ay-yuan-tool__pre' }, argsText) : null,
        h(
          'div',
          { className: 'ay-yuan-tool__result' },
          h(
            'button',
            {
              type: 'button',
              className: 'ay-yuan-tool__toggle ay-yuan-tool__toggle--result',
              'aria-expanded': resultOpen ? 'true' : 'false',
              disabled: resultText === '',
              onClick: () => setResultOpen((value) => !value),
            },
            resultText === ''
              ? t('toolPending')
              : t('toolResult') + ' \u00b7 ' + (resultOpen ? t('toolCollapse') : t('toolExpand')),
          ),
          resultText !== '' && resultOpen
            ? h('pre', { className: 'ay-yuan-tool__pre' + (isError ? ' ay-yuan-tool__pre--error' : '') }, resultText)
            : null,
        ),
      );
    }


    /** 阿源自己的新会话着陆页；发出第一条消息后交回宿主原生 composer。 */
    function AyLanding({ t, actions, onSubmitted, onSend, sameSession = false, welcomeOnly = false }) {
      const [text, setText] = useState('');
      const [failure, setFailure] = useState('');
      const [sending, setSending] = useState(false);
      const send = async (value) => {
        const prompt = String(value === undefined ? text : value).trim();
        if (prompt === '' || sending) return;
        if (onSend) { setSending(true); try { await onSend(prompt); setText(''); setFailure(''); } catch(e) { setFailure(e.message); } finally { setSending(false); } return; }
        if (actions === undefined || actions === null) { setFailure(t('landingNoComposer')); return; }
        try {
          actions.setDraft(prompt);
          actions.submit();
          setText('');
          setFailure('');
          onSubmitted();
        } catch (error) {
          setFailure(error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error));
        }
      };
      const chips = [t('landingChip1'), t('landingChip2'), t('landingChip3'), t('landingChip4')];
      const showChips = !sameSession && (onSend !== undefined || actions !== undefined);
      return h('div', { className: 'ay-landing' + (welcomeOnly ? ' ay-landing--native' : '') },
        h('div', { className: 'ay-landing__mark' }, h(RobotIcon)),
        h('h2', { className: 'ay-landing__title' }, sameSession ? '当前对话在主界面显示' : t('landingTitle')),
        h('p', { className: 'ay-landing__body' }, sameSession ? '你可以在这里继续发送，回复会显示在主界面。' : t('landingBody')),
        showChips ? h('div', { className: 'ay-landing__chips' }, chips.map((chip, index) => h('button', {
          key: 'chip-' + index, type: 'button', className: 'ay-landing__chip', onClick: () => send(chip),
        }, chip))) : null,
        welcomeOnly ? null : h('div', { className: 'ay-landing__composer' },
          h('textarea', {
            className: 'ay-landing__input', rows: 2, value: text, placeholder: t('landingPlaceholder'), 'aria-label': t('landingPlaceholder'),
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } },
          }),
          h('button', { type: 'button', className: 'ay-landing__send', disabled: sending || text.trim() === '', onClick: () => send() }, t('landingSend'))),
        failure !== '' ? h('p', { className: 'ay-landing__error', role: 'alert' }, failure) : null,
        welcomeOnly ? null : h('p', { className: 'ay-landing__hint' }, sameSession ? 'Enter 发送 · Shift+Enter 换行' : t('landingHint')));
    }

    function describeError(error) {
      if (error instanceof Error && error.message !== '') return error.message;
      if (typeof error === 'string' && error !== '') return error;
      return 'unknown error';
    }

    const zh = {
      yuanSourceSession: "来自会话",
      yuanSourceNote: "来自笔记",
      yuanProposalTodo: "建议 todo",
      yuanProposalMemory: "记住了",
      yuanProposalReminder: "提醒",
      yuanCopy: "复制",
      yuanCopied: "已复制",
      yuanCopyCode: "复制代码",
      toolCall: "工具调用",
      toolResult: "结果",
      toolError: "出错",
      toolPending: "已调用",
      toolArgs: "参数",
      toolExpand: "展开",
      toolCollapse: "收起",
      landingTitle: "你好，我是阿源",
      landingBody: "你的看板管家和第二大脑。可以问我待办、让我记住一些事，或者直接聊当前页面。",
      landingPlaceholder: "问阿源点什么…",
      landingSend: "发送",
      landingHint: "Enter 发送 · Shift+Enter 换行 · 第一条消息之后就是原生会话",
      landingNoComposer: "当前会话输入不可用，请在下方原生输入框发送。",
      landingChip1: "今天先做哪三件？",
      landingChip2: "帮我看看本机最近在忙什么",
      landingChip3: "记住：我晚上不看新任务",
      landingChip4: "总结一下我今天的进度",
    };

    const en = {
      yuanSourceSession: "From a session",
      yuanSourceNote: "From a note",
      yuanProposalTodo: "Suggested todo",
      yuanProposalMemory: "Remembered",
      yuanProposalReminder: "Reminder",
      yuanCopy: "Copy",
      yuanCopied: "Copied",
      yuanCopyCode: "Copy code",
      toolCall: "Tool call",
      toolResult: "Result",
      toolError: "Error",
      toolPending: "Called",
      toolArgs: "Arguments",
      toolExpand: "Expand",
      toolCollapse: "Collapse",
      landingTitle: "Hi, I am Yuan",
      landingBody: "Your board assistant and second brain. Ask about todos, ask me to remember something, or talk about the page you are on.",
      landingPlaceholder: "Ask Yuan something…",
      landingSend: "Send",
      landingHint: "Enter to send · Shift+Enter for a newline · the native session takes over after the first message",
      landingNoComposer: "This session input is unavailable; use the native composer below.",
      landingChip1: "What are the top three things today?",
      landingChip2: "What has this machine been working on?",
      landingChip3: "Remember: I do not take new tasks at night",
      landingChip4: "Summarize the progress I made today",
    };

    const CSS = `
.ay-toolbar__row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;min-width:0}
.ay-search__input{flex:1 1 auto;min-width:0;height:30px;padding:0 8px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none}
.ay-search__input::placeholder{color:var(--dsw-alias-label-tertiary)}
.ay-search__input:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px;border-color:transparent}
.ay-search__input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
.ay-yuan-entry{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;flex:none}
.ay-yuan-entry:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-entry:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}
.ay-yuan-entry.is-open{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1))}
.ay-yuan-dot{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-brand-primary);box-sizing:content-box}
.ay-yuan-dot.is-urgent{background:var(--dsw-alias-state-error-primary)}
.ay-yuan-dot.is-warn{background:var(--dsw-alias-state-warn-primary)}
.ay-yuan-dot.is-info{background:var(--dsw-alias-brand-primary)}
.ay-yuan-panel{margin:6px 0 4px;max-height:52vh;overflow-y:auto;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:10px}
.ay-yuan-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.ay-yuan-head__main{display:flex;flex-direction:column;gap:2px;min-width:0}
.ay-yuan-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}
.ay-yuan-title__icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:var(--dsw-radius-xs);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:600}
.ay-yuan-sub{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ay-yuan-close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1;cursor:pointer;flex:none}
.ay-yuan-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-close:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-head__actions{display:flex;align-items:center;gap:6px;flex:none}
.ay-yuan-native{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:10px;line-height:20px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.ay-yuan-native:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-native:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-chips{display:flex;flex-wrap:wrap;gap:6px}
.ay-yuan-chip{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:11px;line-height:20px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.ay-yuan-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-chip--urgent{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1))}
.ay-yuan-chip--warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,var(--dsw-alias-border-l1))}
.ay-yuan-section{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.ay-yuan-section__title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ay-yuan-card{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.ay-yuan-card--expired{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l1))}
.ay-yuan-card__text{font-size:13px;word-break:break-word}
.ay-yuan-card__meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ay-yuan-card__meta--error{color:var(--dsw-alias-state-error-primary)}
.ay-yuan-reasons{display:flex;flex-wrap:wrap;gap:4px}
.ay-yuan-reason{font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.ay-yuan-actions{display:flex;flex-wrap:wrap;gap:6px}
.ay-yuan-btn{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:12px;line-height:22px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.ay-yuan-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.ay-yuan-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-btn:disabled{opacity:.5;cursor:default}
.ay-yuan-btn--primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}
.ay-yuan-btn--primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);opacity:.9}
.ay-yuan-empty{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-error{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.ay-yuan-notice{font-size:12px;color:var(--dsw-alias-state-success-primary)}
.ay-yuan-chat{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;padding-right:2px}
.ay-yuan-msg{max-width:88%;display:flex;flex-direction:column;gap:2px;padding:6px 9px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.ay-yuan-msg--user{align-self:flex-end;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-label-primary)}
.ay-yuan-msg--assistant{align-self:flex-start;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-msg__meta{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-proposals{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.ay-yuan-proposal{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ay-yuan-thinking{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ay-yuan-memory-toggle{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;font:inherit;font-size:12px;line-height:22px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.ay-yuan-memory-toggle:hover{color:var(--dsw-alias-label-primary)}
.ay-yuan-memory-toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px;border-radius:var(--dsw-radius-sm)}
.ay-yuan-memory{display:flex;flex-wrap:wrap;gap:6px}
.ay-yuan-mem{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:11px;line-height:18px;padding:0 4px 0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ay-yuan-mem__text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ay-yuan-mem__del{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;cursor:pointer;flex:none}
.ay-yuan-mem__del:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}
.ay-yuan-composer{display:flex;align-items:flex-end;gap:6px}
.ay-yuan-input{flex:1 1 auto;min-width:0;min-height:30px;max-height:88px;padding:6px 8px;font:inherit;font-size:13px;line-height:1.4;resize:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none}
.ay-yuan-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.ay-yuan-input:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px;border-color:transparent}
.ay-yuan-hint{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-pagecard{margin-bottom:16px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.ay-yuan-pagecard__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.ay-yuan-pagecard__title{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600}
.ay-yuan-pagecard__count{font-size:11px;font-weight:500;line-height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ay-yuan-pagecard__list{display:flex;flex-direction:column;gap:6px}
.ay-yuan-pagecard__row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}
.ay-yuan-pagecard__row:first-child{border-top:none;padding-top:0}
.ay-yuan-pagecard__text{min-width:0;flex:1 1 240px;font-size:13px}
.ay-yuan-pagecard__meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:block;margin-top:2px}
.ay-yuan-msgrow{display:flex;align-items:flex-start;gap:8px;max-width:100%}
.ay-yuan-msgrow--user{justify-content:flex-end}
.ay-yuan-avatar{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:600;flex:none;margin-top:2px}
.ay-yuan-msgbody{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:calc(100% - 34px)}
.ay-yuan-msgbody--user{max-width:82%;align-items:flex-end}
.ay-yuan-msghead{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-msghead--user{justify-content:flex-end}
.ay-yuan-msgname{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ay-yuan-model{font-size:9px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ay-yuan-msgtime{font-variant-numeric:tabular-nums}
.ay-yuan-msgtext{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;min-width:0}
.ay-yuan-bubble{max-width:100%;padding:6px 10px;border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.ay-yuan-copy{display:inline-flex;align-items:center;justify-content:center;height:18px;padding:0 6px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:9px;line-height:18px;cursor:pointer;opacity:0;transition:opacity .12s ease}
.ay-yuan-msgrow:hover .ay-yuan-copy{opacity:1}
.ay-yuan-copy:focus-visible{opacity:1;outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-markdown{display:flex;flex-direction:column;gap:5px;min-width:0}
.ay-yuan-md-p{margin:0;font-size:12px;line-height:1.65}
.ay-yuan-md-heading{margin:2px 0 0;font-weight:600;color:var(--dsw-alias-label-primary)}
.ay-yuan-md-heading--1{font-size:14px}
.ay-yuan-md-heading--2{font-size:13px}
.ay-yuan-md-heading--3,.ay-yuan-md-heading--4,.ay-yuan-md-heading--5,.ay-yuan-md-heading--6{font-size:12px}
.ay-yuan-md-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.55}
.ay-yuan-md-li{word-break:break-word}
.ay-yuan-md-quote{margin:0;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.ay-yuan-md-hr{width:100%;margin:4px 0;border:none;border-top:1px solid var(--dsw-alias-border-l1)}
.ay-yuan-inline-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-link{color:var(--dsw-alias-brand-primary);text-decoration:none}
.ay-yuan-link:hover{text-decoration:underline}
.ay-yuan-task{display:inline-flex;align-items:flex-start;gap:5px}
.ay-yuan-task--done{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
.ay-yuan-task__box{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary);margin-top:1px}
.ay-yuan-task--done .ay-yuan-task__box{color:var(--dsw-alias-state-success-primary)}
.ay-yuan-code{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);overflow:hidden}
.ay-yuan-code__head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:22px;padding:2px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.ay-yuan-code__lang{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-code-copy{font:inherit;font-size:10px;line-height:18px;padding:0 6px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.ay-yuan-code-copy:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.ay-yuan-code-copy:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-code__pre{margin:0;padding:8px 10px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.ay-yuan-welcome{display:flex;flex-direction:column;gap:8px}
.ay-yuan-welcome__text{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.ay-yuan-quick{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.ay-yuan-quick__hint{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-quick__chip{font:inherit;font-size:10px;line-height:20px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.ay-yuan-quick__chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-quick__chip:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-thinking{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ay-yuan-dots{display:inline-flex;align-items:center;gap:3px}
.ay-yuan-dots__dot{width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-label-tertiary);animation:ay-yuan-dot 1.1s ease-in-out infinite}
.ay-yuan-dots__dot:nth-child(2){animation-delay:.15s}
.ay-yuan-dots__dot:nth-child(3){animation-delay:.3s}
.ay-yuan-retry{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-sm);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);font-size:11px;color:var(--dsw-alias-state-error-primary)}
.ay-yuan-toolcard{gap:5px}
.ay-yuan-toolcard__head{display:flex;align-items:center;gap:6px;min-width:0}
.ay-yuan-toolcard__icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:var(--dsw-radius-xs);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);flex:none}
.ay-yuan-toolcard__tag{font-size:10px;font-weight:600;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ay-yuan-toolcard__source{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-memcard{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2)}
.ay-yuan-memcard--pending{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-border-l1))}
.ay-yuan-memcard__main{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.ay-yuan-memcard__text{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-word}
.ay-yuan-badge{font-size:9px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ay-yuan-badge--pending{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.ay-yuan-memory{display:flex;flex-direction:column;gap:4px}
.ay-yuan-memory-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px}
.ay-yuan-input{max-height:132px}
.ay-yuan-send{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);cursor:pointer;flex:none}
.ay-yuan-send:hover:not(:disabled){opacity:.9}
.ay-yuan-send:disabled{opacity:.45;cursor:default}
.ay-yuan-send:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}
.ay-yuan-composer-hint{margin-top:2px;font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:right}
@keyframes ay-yuan-dot{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
.ay-yuan-tools{display:flex;flex-direction:column;gap:5px}
.ay-yuan-tool{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base)}
.ay-yuan-tool--error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}
.ay-yuan-tool__head{display:flex;align-items:center;gap:6px;min-width:0}
.ay-yuan-tool__icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-tool__name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.ay-yuan-tool__state{font-size:9px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}
.ay-yuan-tool--error .ay-yuan-tool__state{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.ay-yuan-tool__toggle{font:inherit;font-size:10px;line-height:18px;padding:0 6px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.ay-yuan-tool__toggle:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-yuan-tool__toggle:disabled{opacity:.6;cursor:default}
.ay-yuan-tool__toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-yuan-tool__toggle--args{margin-left:auto}
.ay-yuan-tool__args{display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:10px;line-height:16px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ay-yuan-tool__args:hover{color:var(--dsw-alias-label-primary)}
.ay-yuan-tool__args:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px;border-radius:var(--dsw-radius-xs)}
.ay-yuan-tool__pre{margin:0;padding:4px 6px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}
.ay-yuan-tool__pre--error{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.ay-yuan-tool__result{display:flex;flex-direction:column;gap:4px}
.ay-yuan-agent{font-size:9px;line-height:14px;padding:0 5px;border-radius:999px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);white-space:nowrap}
.ay-yuan-agent--degraded{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.ay-yuan-welcome__hint{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
@media (max-width:720px){.ay-yuan-panel{max-height:60vh}.ay-yuan-pagecard{padding:12px}}
.ay-yuan-launch{position:relative;display:inline-flex;align-items:center}
.ay-yuan-entry{width:34px;height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.ay-yuan-entry:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.ay-yuan-entry:disabled{opacity:.5;cursor:wait}
.ay-yuan-native{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ay-native-name{display:inline-flex;align-items:center;gap:6px;font-weight:600;margin-right:4px}
.ay-yuan-native .ay-yuan-btn{font-size:12px;padding:3px 8px}
.ay-context-chip{max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);padding:4px 8px;border-radius:20px;font:inherit;cursor:pointer}
.ay-native-popover{box-sizing:border-box;position:fixed;z-index:1000;right:24px;top:110px;width:440px;max-width:calc(100vw - 32px);max-height:calc(100vh - 145px);overflow:auto;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-base);box-shadow:0 12px 40px #0002;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;text-align:left;white-space:normal}
.ay-native-popover *{box-sizing:border-box}
.ay-native-popover-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px}
.ay-native-popover pre,.ay-native-popover blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.ay-native-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary);margin:6px 0 14px}
.ay-native-error{position:absolute;z-index:1001;right:0;top:38px;width:280px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;white-space:normal;box-shadow:0 8px 24px #0002}
.ay-native-empty{padding:30px 8px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.ay-memory-row{padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}
.ay-memory-row p{margin:8px 0;white-space:pre-wrap;line-height:1.65}
.ay-memory-row details{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0}
.ay-memory-row summary{cursor:pointer}
.ay-memory-row blockquote{margin:8px 0;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l2);white-space:pre-wrap}
.ay-memory-edit{width:100%;min-height:90px;resize:vertical;font:inherit;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit}
.ay-search__input{height:36px;border-radius:8px}
.ay-filter-details .ay-toolbar__row{margin-top:8px}
@media(max-width:640px){.ay-native-popover{right:12px;top:105px;max-width:calc(100vw - 24px)}.ay-native-name{display:none}.ay-context-chip{max-width:110px}}
.ay-yuan-float{position:fixed;right:24px;bottom:24px;z-index:120;pointer-events:auto;display:flex;flex-direction:column;width:620px;height:720px;max-width:calc(100vw - 32px);max-height:calc(100vh - 72px);min-width:min(380px,calc(100vw - 32px));min-height:320px;resize:both;overflow:hidden;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 16px 60px #0003;font-size:14px}
.ay-yuan-float-wide{width:940px;height:850px}
.ay-yuan-float{resize:none}
.ay-yuan-resize{position:absolute;bottom:4px;right:4px;width:28px;height:28px;padding:4px;border:0;background:var(--dsw-alias-bg-layer-1);border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:nwse-resize;touch-action:none;z-index:5;display:grid;place-items:center}
.ay-yuan-float-foot{flex:none;height:28px;padding:5px 40px 5px 16px;font-size:10px;color:var(--dsw-alias-label-tertiary);box-sizing:border-box}
.ay-yuan-whale{flex:none;transition:transform .18s}.ay-yuan-entry:hover .ay-yuan-whale,.ay-yuan-bubble:hover .ay-yuan-whale{transform:translateY(-2px) rotate(-7deg)}
@media(prefers-reduced-motion:reduce){.ay-yuan-whale{transition:none}.ay-yuan-entry:hover .ay-yuan-whale,.ay-yuan-bubble:hover .ay-yuan-whale{transform:none}}
.ay-yuan-view-tabs{display:flex;gap:20px;padding:8px 18px 0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);position:sticky;top:0;z-index:3}
.ay-yuan-view-tabs button{font:inherit;font-size:13px;padding:6px 0;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer}
.ay-yuan-view-tabs button[aria-selected=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.ay-yuan-float-head{display:flex;align-items:center;gap:8px;flex:none;padding:14px 16px 10px;cursor:move;touch-action:none;user-select:none}
.ay-yuan-float-identity{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.ay-yuan-float-identity strong{font-size:16px}.ay-yuan-float-identity span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ay-yuan-float>.ay-yuan-native{padding:0 12px 10px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;cursor:default;flex:none;background:transparent}
.ay-header-icon{width:30px;padding:0;min-height:28px}
.ay-settings{position:absolute;z-index:1002;right:12px;top:48px;width:260px;box-sizing:border-box;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:0 8px 24px #0002;font-size:12px}.ay-settings-head{display:flex;align-items:center;justify-content:space-between}.ay-settings p{color:var(--dsw-alias-label-secondary);margin:12px 0 5px}.ay-settings label{display:flex;justify-content:space-between;align-items:center;padding:7px 0}.ay-settings select{font:inherit;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:4px}.ay-settings small{display:block;color:var(--dsw-alias-label-tertiary);margin-top:8px}.ay-settings-preview{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);line-height:1.45}.ay-settings-preview span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ay-yuan-float-body{--dsh-content-font-size:var(--ay-interface-font);--dsh-content-font-delta:var(--ay-interface-delta);font-size:var(--ay-interface-font);flex:1;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden}
.ay-yuan-float-body [data-chat-flow]{--dsh-content-font-size:var(--ay-reply-font);--dsh-content-font-delta:var(--ay-reply-delta);font-size:var(--ay-reply-font)}
.ay-yuan-float-body>[data-conversation-content]{flex:1;min-height:0;--dsh-chat-user-width:100%;--dsh-chat-content-padding:16px}
.ay-yuan-float .ay-native-popover{position:absolute;top:92px;right:12px;max-height:calc(100% - 110px);max-width:calc(100% - 24px);z-index:10}
.ay-yuan-bubble{position:fixed;right:24px;bottom:24px;pointer-events:auto;display:flex;align-items:center;gap:8px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 6px 24px #0002;cursor:grab;touch-action:none;user-select:none;z-index:120}
.ay-yuan-bubble:active{cursor:grabbing}
.ay-yuan-float-head:active{cursor:grabbing}

.ay-landing{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;flex:1;min-height:0;padding:28px 24px;text-align:center;overflow-y:auto}
.ay-landing__mark{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1))}
.ay-landing__mark .ay-yuan-whale{width:34px;height:34px}
.ay-landing__title{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ay-landing__body{margin:0;max-width:420px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.ay-landing__chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:520px}
.ay-landing__chip{font:inherit;font-size:11px;line-height:22px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.ay-landing__chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ay-landing__chip:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
.ay-landing__composer{display:flex;align-items:flex-end;gap:6px;width:min(520px,100%)}
.ay-landing__input{flex:1 1 auto;min-width:0;min-height:34px;max-height:96px;padding:7px 9px;font:inherit;font-size:13px;line-height:1.4;resize:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;outline:none}
.ay-landing__input:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px;border-color:transparent}
.ay-landing__send{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:12px;line-height:32px;padding:0 14px;border:none;border-radius:10px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);cursor:pointer;flex:none}
.ay-landing__send:disabled{opacity:.45;cursor:default}
.ay-landing__error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
.ay-landing__hint{margin:0;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.ay-landing--native{justify-content:center;padding-bottom:8px}

.ay-yuan-bubble{width:42px;height:42px;justify-content:center;padding:3px;gap:0;border-radius:50%;box-shadow:0 3px 14px #00000014;line-height:1}
.ay-yuan-bubble .ay-yuan-whale{width:30px;height:30px}
/* 阿源历史列表：按宿主左侧会话行的结构仿制；字号和对比度按浮框可读性略放大。 */
.ay-native-popover--history{padding:12px 10px 10px;width:420px;font-size:14px}
.ay-native-popover--history .ay-native-popover-head{padding:0 6px 10px;margin-bottom:2px;font-size:15px}
.ay-history-list{display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 260px);overflow:auto;margin:0 -2px;padding:0 2px}
.ay-history-item{display:flex;align-items:center;min-height:36px;padding:0 10px;border-radius:var(--dsw-radius-md);cursor:pointer;color:var(--dsw-alias-label-primary);user-select:none;outline:none}
.ay-history-item:hover,.ay-history-item.is-menu-open{background:var(--dsw-alias-interactive-bg-hover)}
.ay-history-item:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:-2px}
.ay-history-leading{width:18px;height:22px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.ay-history-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.ay-history-title{flex:1 1 auto;min-width:0;margin:0 8px 0 4px;font-size:15px;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ay-history-time{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
.ay-history-item:hover .ay-history-time,.ay-history-item.is-menu-open .ay-history-time{display:none}
.ay-history-native-actions{flex:none;display:none;align-items:center;gap:14px;margin-left:auto}
.ay-history-item:hover .ay-history-native-actions,.ay-history-item:focus-within .ay-history-native-actions,.ay-history-item.is-menu-open .ay-history-native-actions{display:inline-flex}
.ay-history-native-actions button{color:var(--dsw-alias-label-secondary);padding:2px;border-radius:var(--dsw-radius-xs);display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;cursor:pointer}
.ay-history-native-actions button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ay-history-native-actions svg{width:18px;height:18px}
.ay-history-more{width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.ay-history-more:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ay-history-more svg{width:18px;height:18px}
.ay-history-hover{min-width:240px;max-width:320px;padding:2px 0}
.ay-history-hover-title{color:#fff;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.ay-history-hover-time{margin-top:4px;color:#cfd3d6;font-size:12px;line-height:16px}
.ay-history-hover-extra{color:#cfd3d6;font-size:12px;line-height:18px}
.ay-history-hover-extra:not(:empty){margin-top:8px}
.ay-history-hover-status{display:flex;align-items:center;gap:8px;margin-top:8px;color:#adb2b8;font-size:12px;line-height:20px}
@media(hover:none){.ay-history-time{display:none}.ay-history-native-actions{display:inline-flex}}
.ay-native-popover--snapshot{width:380px;padding:16px}
.ay-snapshot-status{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary);margin:2px 0 12px}
.ay-snapshot-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:20px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.ay-snapshot-badge:before{content:'';width:6px;height:6px;border-radius:50%;background:#37a374}
.ay-snapshot-badge.is-stale:before{background:#cf963a}
.ay-snapshot-source{padding:13px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:14px}
.ay-snapshot-eyebrow,.ay-snapshot-state{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ay-snapshot-source h3{margin:4px 0;font-size:15px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}
.ay-snapshot-field{display:grid;grid-template-columns:65px minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;overflow-wrap:anywhere}
.ay-snapshot-field>span{color:var(--dsw-alias-label-tertiary)}
.ay-snapshot-id{display:flex;align-items:flex-start;gap:6px;min-width:0}
.ay-snapshot-id code{flex:1;min-width:0;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.ay-snapshot-id button{flex:none}
.ay-snapshot-footnote{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:12px 0 4px}
.ay-snapshot .ay-native-hint{margin:0;font-size:11px}

`;

    /** Idempotent stylesheet install/remove keyed by a plugin CSS id. */
    function insertStyle(tagId, css) {
      const selector = 'style[data-plugin-css=' + JSON.stringify(tagId) + ']';
      const existing = document.querySelector(selector);
      if (existing === null) {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'ayuan';
        tag.dataset.pluginCss = tagId;
        tag.textContent = css;
        document.head.appendChild(tag);
      }
      return () => {
        const tag = document.querySelector(selector);
        if (tag !== null) tag.remove();
      };
    }

    // -- plugin apply -----------------------------------------------------------

    function apply(ctx) {
      clientContext = ctx;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ayuan: dictionaries');
      boundT = ctx.locale.bind(NS);

      ctx.effect(() => insertStyle('ayuan/client.css', CSS), 'ayuan: client styles');
      ctx.effect(() => installNativeHistory(ctx), 'ayuan: native history actions');
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ayuan', order: 50,
        children: { 'ayuan.conversation': { kind: 'single', scope: 'session' } } }, YuanFloatingPanel)), 'ayuan: floating surface');
      ctx.effect(() => ctx.slots.inject('ayuan.conversation', () => ctx.slots.register({ name: 'ayuan.conversation' }, YuanEmbeddedChat)), 'ayuan: embedded native conversation');

      // 原生会话标题栏工具：新会话 / 历史 / 记忆 / 位置。
      ctx.effect(
        () =>
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              { name: 'conversation.session.header.utilities', id: 'ayuan-native-tools', order: 5, locale: NS },
              YuanNativeTools,
            ),
          ),
        'ayuan: native tools',
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };

  },
});
