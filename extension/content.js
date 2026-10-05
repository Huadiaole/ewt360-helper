/* 由 tools/build-extension.mjs 自动生成，请勿手改 —— 改 ewt360-helper.user.js 后重新构建 */
// 扩展版预设：装好即全开
(function () {
  try {
    window.__EWT_PRESET = Object.assign({}, window.__EWT_PRESET, {
      enabled: true,
      forceSpeed: true,
      speed: 4,
      autoNext: true,
      autoSkip: true,
      autoCheck: true,
      autoResume: true
    });
    window.__EWT_HOST = 'extension';
  } catch (e) {}
})();



(function () {
  'use strict';

  if (window.__EWT_LOADED__) return;
  window.__EWT_LOADED__ = true;

  /* ==================================================================
   * 0. 配置
   * ================================================================== */
  const CFG_KEY = 'ewt_helper_cfg';
  const DEFAULTS = {
    enabled: false,        // 总开关
    forceSpeed: true,      // 强制倍速
    speed: 4,              // 目标倍速
    mute: false,           // 静音(高倍速建议开)
    boostSeek: false,      // >16x 时用补帧跳进实现超上限倍速
    autoNext: true,        // 自动连播
    nextMode: 'ended',     // ended=播完切换 | progress85=85%切换
    autoResume: true,      // 切集后/被暂停时自动恢复播放
    autoSkip: true,        // 自动跳过 / 作答课中选择题
    answerStrategy: 'auto',// auto=先找正确项线索 | first | random | longest
    autoCheck: true,       // 自动过认真度检查
    keepAlive: false,      // 后台保活(伪造页面可见性)
    lockProgress: false,   // 锁定进度条(防误拖动)
    debug: false,
    panelOpen: false
  };
  const CFG = Object.assign({}, DEFAULTS);
  function loadCfg() {
    // 宿主环境（Electron / Android WebView）可以先塞 window.__EWT_PRESET 来改默认值
    try { if (window.__EWT_PRESET) Object.assign(DEFAULTS, window.__EWT_PRESET, {}); } catch (e) {}
    try { Object.assign(CFG, DEFAULTS); } catch (e) {}
    try { Object.assign(CFG, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) {}
  }
  loadCfg();

  const on = (k) => CFG.enabled && CFG[k];

  /* ==================================================================
   * 1. 工具
   * ================================================================== */
  const Log = {
    line(msg) {
      console.log('[EWT]', msg);
      const el = document.getElementById('ewt-status');
      if (el) el.textContent = msg;
    },
    dbg(msg) { if (CFG.debug) console.debug('[EWT][debug]', msg); },
    err(msg, e) { console.error('[EWT]', msg, e || ''); }
  };

  const norm = (s) => String(s == null ? '' : s).replace(/[\s\u200b\u3000]/g, '');

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    if (parseFloat(st.opacity || '1') < 0.05) return false;
    return true;
  }

  // 合成点击：普通点击 + 指针事件兜底，兼容 Vue/React/video.js
  function realClick(el) {
    if (!el) return false;
    try {
      if (el.closest && el.closest('.ewt-root')) return false;
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (e) {}
    try {
      if (typeof el.click === 'function') { el.click(); return true; }
    } catch (e) {}
    try {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => {
        const Ctor = t.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(t, { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    } catch (e) { return false; }
  }

  const Cool = {
    map: new WeakMap(),
    ready(el, ms) {
      const now = Date.now();
      const last = this.map.get(el) || 0;
      if (now - last < ms) return false;
      this.map.set(el, now);
      return true;
    }
  };

  const IGNORE_SCOPE = '.ewt-root,.vjs-control-bar,.vjs-menu,.vjs-menu-button,.vjs-volume-panel';

  /**
   * 按文本找可点击元素（文本节点级扫描，避开整页 textContent 的开销）
   * @returns {{el:Element,text:string}|null}
   */
  function findTextTarget(keywords, opt) {
    opt = opt || {};
    if (!document.body) return null;
    const exact = !!opt.exact;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      if (!raw || raw.length > 40) continue;
      const t = norm(raw);
      if (!t || t.length > 24) continue;
      let hit = false;
      for (let i = 0; i < keywords.length; i++) {
        const k = keywords[i];
        if (exact ? t === k : (t === k || t.indexOf(k) >= 0)) { hit = true; break; }
      }
      if (!hit) continue;

      let el = node.parentElement;
      if (!el) continue;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
      if (el.closest(IGNORE_SCOPE)) continue;
      if (!isVisible(el)) continue;

      const btnLike = el.closest('button,a,[role="button"],[class*="btn"],[class*="Btn"],[class*="button"],input,[onclick]');
      if (opt.requireClickable && !btnLike) continue;
      const clickable = btnLike || el;
      if (clickable.closest && clickable.closest(IGNORE_SCOPE)) continue;
      return { el: clickable, text: t, btnLike: !!btnLike };
    }
    return null;
  }

  function closestModal(el) {
    if (!el || !el.closest) return null;
    return el.closest(
      '[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="Modal"],' +
      '[class*="popup"],[class*="Popup"],[class*="mask"],[class*="Mask"],' +
      '[class*="layer"],[class*="Layer"],[class*="tips"],[class*="Tips"],' +
      '[role="dialog"],.vjs-modal-dialog'
    );
  }

  /* ==================================================================
   * 2. isTrusted 反检测绕过（站点会对合成点击做 isTrusted 校验）
   * ================================================================== */
  (function patchIsTrusted() {
    try {
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      const wrapMap = new WeakMap();

      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (typeof listener !== 'function' || !/^(click|submit|change|mousedown|mouseup)$/.test(type)) {
          return add.call(this, type, listener, options);
        }
        let src = '';
        try { src = String(listener); } catch (e) {}
        if (src.indexOf('isTrusted') < 0) return add.call(this, type, listener, options);

        Log.dbg('检测到 isTrusted 校验的监听器: ' + src.slice(0, 120));
        let wrapped = wrapMap.get(listener);
        if (!wrapped) {
          wrapped = function (event) {
            if (event && typeof event === 'object' && 'isTrusted' in event) {
              const proxy = new Proxy(event, {
                get(target, prop) {
                  if (prop === 'isTrusted' && target.isTrusted === false) {
                    Log.dbg('篡改 ' + target.type + ' 事件 isTrusted: false -> true');
                    return true;
                  }
                  const v = target[prop];
                  return typeof v === 'function' ? v.bind(target) : v;
                }
              });
              return listener.call(this, proxy);
            }
            return listener.call(this, event);
          };
          wrapMap.set(listener, wrapped);
          wrapMap.set(wrapped, listener);
        }
        return add.call(this, type, wrapped, options);
      };

      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (typeof listener === 'function') {
          const w = wrapMap.get(listener);
          if (w) return remove.call(this, type, w, options);
        }
        return remove.call(this, type, listener, options);
      };
      console.log('[EWT] isTrusted 绕过已装载');
    } catch (e) { Log.err('isTrusted 绕过装载失败', e); }
  })();

  /* ==================================================================
   * 3. 强制倍速：从 prototype 根部劫持 playbackRate
   * ================================================================== */
  const MAX_NATIVE_RATE = 16;

  const ForceSpeed = {
    desc: null,
    installed: false,

    install() {
      if (this.installed) return;
      try {
        const proto = HTMLMediaElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
        if (!d || !d.set || !d.get) { Log.err('拿不到 playbackRate 描述符，降级为轮询强制'); this.installed = true; return; }
        this.desc = d;
        const self = this;

        Object.defineProperty(proto, 'playbackRate', {
          configurable: true,
          enumerable: d.enumerable,
          get() { return d.get.call(this); },
          set(v) { d.set.call(this, self.targetRate()); }   // 站点写什么都强制成我们的值
        });
        Object.defineProperty(proto, 'defaultPlaybackRate', {
          configurable: true,
          enumerable: true,
          get() { return d.get.call(this); },
          set(v) { d.set.call(this, self.targetRate()); }
        });

        // play() 之后再强制一次，防止站点在 play 里重置
        const origPlay = proto.play;
        if (typeof origPlay === 'function') {
          proto.play = function () {
            const r = origPlay.apply(this, arguments);
            try { self.hardSet(this); } catch (e) {}
            return r;
          };
        }
        this.installed = true;
        Log.dbg('playbackRate 劫持完成');
      } catch (e) { Log.err('倍速劫持失败', e); }
    },

    targetRate() {
      if (!CFG.enabled || !CFG.forceSpeed) return 1;
      const s = Number(CFG.speed) || 1;
      return Math.max(0.1, Math.min(MAX_NATIVE_RATE, s));
    },

    // 绕过自己的 setter，直接写底层
    hardSet(v) {
      const d = this.desc || Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      if (!d || !d.set) return;
      const r = this.targetRate();
      if (Math.abs(d.get.call(v) - r) > 0.01) d.set.call(v, r);
      if (CFG.enabled && CFG.forceSpeed && CFG.mute !== !!v.muted) {
        try { v.muted = CFG.mute ? true : v.muted; } catch (e) {}
      }
    },

    apply() { this.enforce(true); },

    enforce(force) {
      if (!this.installed) this.install();
      const vids = document.querySelectorAll('video,audio');
      for (let i = 0; i < vids.length; i++) {
        try {
          if (!force && !CFG.enabled) break;
          this.hardSet(vids[i]);
        } catch (e) {}
      }
      if (CFG.enabled && CFG.forceSpeed && CFG.mute) {
        for (let i = 0; i < vids.length; i++) { try { vids[i].muted = true; } catch (e) {} }
      }
    },

    // 超上限倍速：原生 16x + 定时向前补帧
    boostTick() {
      if (!on('forceSpeed') || !CFG.boostSeek) return;
      if (Number(CFG.speed) <= MAX_NATIVE_RATE) return;
      const extraPerSec = Number(CFG.speed) - MAX_NATIVE_RATE;
      const vids = document.querySelectorAll('video');
      for (let i = 0; i < vids.length; i++) {
        const v = vids[i];
        if (v.paused || !v.duration || isNaN(v.duration)) continue;
        const jump = extraPerSec * (this.BOOST_MS / 1000);
        if (v.currentTime + jump < v.duration - 1) v.currentTime += jump;
      }
    },
    BOOST_MS: 500,
    boostTimer: null,

    startTimers() {
      setInterval(() => this.enforce(false), 800);
      document.addEventListener('ratechange', (e) => {
        if (on('forceSpeed') && e.target && e.target.playbackRate !== undefined) {
          try { this.hardSet(e.target); } catch (err) {}
        }
      }, true);
      ['play', 'playing', 'loadedmetadata', 'canplay'].forEach((t) => {
        document.addEventListener(t, (e) => {
          if (on('forceSpeed')) { try { this.hardSet(e.target); } catch (err) {} }
        }, true);
      });
      this.boostTimer = setInterval(() => this.boostTick(), this.BOOST_MS);
    }
  };

  /* ==================================================================
   * 4. 自动过认真度检查
   * ================================================================== */
  // 精确命中的按钮文字（任何位置都点）
  const CHECK_HIT = ['点击通过检查', '点击完成检查', '点击确认检查', '点击验证', '通过检查', '检查通过', '开始检查'];
  // 宽松命中：必须落在按钮类元素上，避免把弹窗标题「认真度检查：请点击…」当按钮点掉
  const CHECK_LOOSE = ['认真度检查', '认真度检测', '点击通过', '点击确认'];
  const CHECK_WEAK = ['确定', '确认', '我知道了', '知道了', '好的', '继续观看', '继续学习', '继续播放', '我已了解', '我已知晓', '继续'];

  const AutoCheck = {
    timer: null,

    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), 700);
      document.addEventListener('DOMContentLoaded', () => this.observe());
      this.observe();
    },

    observe() {
      if (!document.body || this.observer) return;
      this.observer = new MutationObserver(() => {
        if (on('autoCheck')) setTimeout(() => this.tick(), 150);
      });
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    },

    tick() {
      if (!on('autoCheck') || !document.body) return;
      try {
        // 1) 先精确匹配按钮文字（任何位置都能点），再退回「按钮类元素 + 宽松关键词」
        const strong = findTextTarget(CHECK_HIT, { exact: true }) ||
                       findTextTarget(CHECK_LOOSE, { requireClickable: true });
        if (strong && Cool.ready(strong.el, 2500)) {
          realClick(strong.el);
          Log.line('已通过认真度检查("' + strong.text + '")');
          return;
        }
        // 2) 弱特征按钮：必须是弹窗内的
        const weak = findTextTarget(CHECK_WEAK);
        if (weak && closestModal(weak.el) && Cool.ready(weak.el, 2500)) {
          const modal = closestModal(weak.el);
          // 弹窗里若有勾选框/单选项，先勾上
          const box = modal.querySelector('input[type="checkbox"]:not(:checked),input[type="radio"]:not(:checked),[class*="checkbox"]:not([class*="checked"]),[class*="radio"]:not([class*="checked"])');
          if (box && Cool.ready(box, 1500)) { realClick(box); Log.dbg('勾选检查弹窗内的选项'); }
          realClick(weak.el);
          Log.line('已处理检查弹窗("' + weak.text + '")');
        }
      } catch (e) { Log.err('过检出错', e); }
    }
  };

  /* ==================================================================
   * 5. 自动跳过 / 作答 课中选择题
   * ================================================================== */
  const SKIP_TEXTS = ['跳过本题', '跳过此题', '跳过该题', '跳过', 'Skip', '取消作答'];
  const SUBMIT_TEXTS = ['提交答案', '确定答案', '提交本题', '提交', '确定', '下一题', '继续观看', '继续学习'];
  const PANEL_SEL = '[class*="ques"],[class*="Ques"],[class*="exam"],[class*="Exam"],[class*="topic"],[class*="Topic"],[class*="problem"],[class*="Problem"],[class*="choice"],[class*="Choice"],[class*="answer"],[class*="Answer"],[class*="test"],[class*="Test"]';
  const OPTION_SEL = 'li,label,[class*="option"],[class*="Option"],[class*="item"],[class*="answer"],[class*="Answer"],[class*="radio"]';
  const CORRECT_HINT_SEL = '[data-correct],[data-right],[data-answer],[data-is-correct],.correct,.right,.is-correct,[class*="correct"],[class*="Correct"],[class*="right"],[class*="Right"],.vjs-correct';

  const AutoSkip = {
    timer: null,

    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), 900);
    },

    tick() {
      if (!on('autoSkip') || !document.body) return;
      try {
        const skip = findTextTarget(SKIP_TEXTS);
        if (skip && Cool.ready(skip.el, 2500)) {
          realClick(skip.el);
          Log.line('已跳过课中题目("' + skip.text + '")');
          return;
        }
        const panel = this.findPanel();
        if (!panel) return;
        if (!Cool.ready(panel, 4000)) return;

        const opts = this.findOptions(panel);
        if (opts.length >= 2) {
          const pick = this.pick(opts, panel);
          realClick(pick.el);
          Log.line('已作答(' + (pick.idx + 1) + '/' + opts.length + ')：' + pick.text.slice(0, 12));
          setTimeout(() => this.submit(), 450);
          return;
        }
        this.submit();
      } catch (e) { Log.err('跳题出错', e); }
    },

    findPanel() {
      const cands = Array.from(document.querySelectorAll(PANEL_SEL))
        .filter((el) => isVisible(el) && !el.closest(IGNORE_SCOPE) && el.querySelectorAll(OPTION_SEL).length >= 2);
      if (!cands.length) return null;
      // 取“最小”的那个（最内层的题目容器）
      cands.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      return cands[0];
    },

    findOptions(panel) {
      const seen = new Set();
      const out = [];
      const nodes = panel.querySelectorAll(OPTION_SEL);
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (seen.has(el)) continue;
        seen.add(el);
        if (!isVisible(el)) continue;
        const t = norm(el.textContent);
        if (!t || t.length > 80) continue;
        if (/^(提交|确定|下一题|继续观看|跳过)/.test(t)) continue;
        // 排除嵌套重复：父节点已经收集过就丢掉
        if (out.some((o) => o.el.contains(el))) continue;
        out.push({ el, text: t });
        if (out.length >= 12) break;
      }
      return out;
    },

    pick(opts, panel) {
      const strategy = CFG.answerStrategy || 'auto';
      if (strategy === 'auto') {
        const hint = panel.querySelector(CORRECT_HINT_SEL);
        if (hint && isVisible(hint)) {
          const idx = opts.findIndex((o) => o.el === hint || o.el.contains(hint) || hint.contains(o.el));
          if (idx >= 0) return Object.assign({ idx }, opts[idx]);
        }
        // video.js 的题目有时把答案写在 data 上
        const dataIdx = this.readDataAnswer(panel);
        if (dataIdx != null && opts[dataIdx]) return Object.assign({ idx: dataIdx }, opts[dataIdx]);
      }
      if (strategy === 'random') {
        const i = Math.floor(Math.random() * opts.length);
        return Object.assign({ idx: i }, opts[i]);
      }
      if (strategy === 'longest') {
        let bi = 0;
        opts.forEach((o, i) => { if (o.text.length > opts[bi].text.length) bi = i; });
        return Object.assign({ idx: bi }, opts[bi]);
      }
      return Object.assign({ idx: 0 }, opts[0]);
    },

    readDataAnswer(panel) {
      const keys = ['answer', 'correct', 'right', 'correctIndex', 'rightIndex', 'answerIndex'];
      const nodes = [panel].concat(Array.from(panel.querySelectorAll('[data-answer],[data-correct],[data-right]')));
      for (const n of nodes) {
        for (const k of keys) {
          const v = n.getAttribute && n.getAttribute('data-' + k);
          if (v == null || v === '') continue;
          const n2 = parseInt(v, 10);
          if (!isNaN(n2) && n2 >= 0 && n2 <= 10) return n2;
        }
      }
      return null;
    },

    submit() {
      const btn = findTextTarget(SUBMIT_TEXTS, { exact: false });
      if (!btn) { Log.dbg('未找到提交/继续按钮'); return; }
      if (!Cool.ready(btn.el, 1500)) return;
      realClick(btn.el);
      Log.line('已提交/继续("' + btn.text + '")');
    }
  };

  /* ==================================================================
   * 6. 自动连播
   * ================================================================== */
  const NEXT_BTN_TEXTS = ['下一节', '下一课', '下一集', '下一讲', '下一章', '下一个', '下一课时'];

  const AutoNext = {
    timer: null,
    lastSwitch: 0,
    pendingPlayAt: 0,

    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), 400);
      ['ended', 'pause'].forEach((t) => {
        document.addEventListener(t, (e) => {
          if (!e.target || e.target.tagName !== 'VIDEO') return;
          if (t === 'ended' && on('autoNext')) this.goNext('ended事件');
        }, true);
      });
    },

    tick() {
      if (!CFG.enabled || !document.body) return;
      const now = Date.now();
      const vids = document.querySelectorAll('video');
      for (let i = 0; i < vids.length; i++) {
        const v = vids[i];
        if (!v.duration || isNaN(v.duration) || v.duration < 5) continue;

        // 自动恢复播放（切集后 / 被站点暂停）
        if (on('autoResume') && v.paused && now - this.pendingPlayAt < 15000) {
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
          Log.dbg('自动恢复播放');
        }

        if (!on('autoNext')) continue;
        if (now - this.lastSwitch < 8000) continue;

        const remain = v.duration - v.currentTime;
        const reached = CFG.nextMode === 'progress85'
          ? (v.currentTime / v.duration) >= 0.85
          : remain <= 1.5;
        if (!reached) continue;
        if (v.currentTime < 3) continue;

        this.lastSwitch = now;
        this.goNext(CFG.nextMode === 'progress85' ? '进度85%' : '即将播完');
        return;
      }
    },

    goNext(reason) {
      Log.dbg('触发连播：' + reason);
      const next = this.findNext();
      if (!next) { Log.line('连播：没找到下一节（可能已是最后一节）'); return; }
      realClick(next.el);
      this.pendingPlayAt = Date.now();
      Log.line('自动连播 → ' + (next.text || '下一节') + '（' + reason + '）');
    },

    findNext() {
      // 路径A：已知哈希类名的快路（旧版选择器，命中就直接用）
      const fastActive = document.querySelector('.listCon-zrsBh .item-blpma.active-EI2Hl');
      if (fastActive && fastActive.nextElementSibling) {
        return { el: fastActive.nextElementSibling, text: norm(fastActive.nextElementSibling.textContent).slice(0, 14) };
      }

      // 路径B：通用 —— 找带 active 的列表项，取它的下一个兄弟
      const actives = Array.from(document.querySelectorAll('[class*="active"],[class*="Active"],[aria-selected="true"]'))
        .filter((el) => !el.closest(IGNORE_SCOPE) && isVisible(el) && el.parentElement);

      let best = null;
      for (const a of actives) {
        const p = a.parentElement;
        const kids = Array.from(p.children);
        if (kids.length < 2 || kids.length > 300) continue;
        const idx = kids.indexOf(a);
        if (idx < 0 || idx + 1 >= kids.length) continue;
        let score = 0;
        const cls = String(a.className || '');
        if (/item|chapter|lesson|node|video|list|course|section|part|menu/i.test(cls)) score += 2;
        if (kids.length >= 3) score += 1;
        const t = norm(a.textContent);
        if (t.length >= 2 && t.length <= 80) score += 1;
        if (a.querySelector('video')) score += 3;
        if (score >= 2 && (!best || score > best.score)) best = { score, a, next: kids[idx + 1] };
      }
      if (best) return { el: best.next, text: norm(best.next.textContent).slice(0, 14) };

      // 路径C：文本按钮
      const btn = findTextTarget(NEXT_BTN_TEXTS);
      if (btn) return { el: btn.el, text: btn.text };
      return null;
    }
  };

  /* ==================================================================
   * 7. 后台保活 & 进度条锁定
   * ================================================================== */
  const KeepAlive = {
    patched: false,
    install() {
      if (this.patched) return;
      this.patched = true;
      try {
        const define = (obj, prop, val) => {
          try { Object.defineProperty(obj, prop, { configurable: true, get: () => val }); } catch (e) {}
        };
        define(document, 'hidden', false);
        define(document, 'visibilityState', 'visible');
        define(document, 'webkitHidden', false);
        define(document, 'webkitVisibilityState', 'visible');
        const stop = (e) => { if (CFG.keepAlive) { try { e.stopImmediatePropagation(); } catch (x) {} } };
        window.addEventListener('visibilitychange', stop, true);
        document.addEventListener('visibilitychange', stop, true);
        window.addEventListener('blur', (e) => { if (CFG.keepAlive) { try { e.stopImmediatePropagation(); } catch (x) {} } }, true);
        Log.dbg('后台保活已装载');
      } catch (e) { Log.err('后台保活装载失败', e); }
    }
  };

  const ProgressLock = {
    ID: 'ewt-progress-lock',
    toggle(onFlag) {
      const old = document.getElementById(this.ID);
      if (old) old.remove();
      if (!onFlag) return;
      const st = document.createElement('style');
      st.id = this.ID;
      st.textContent = '[class*="progress"],[class*="Progress"],[class*="prgs"],[class*="slider"]{pointer-events:none!important;}';
      (document.head || document.documentElement).appendChild(st);
    }
  };

  /* ==================================================================
   * 8. 控制面板（美化版 UI）
   *    - 渐变毛玻璃卡片 / 可拖动 / Esc 关闭
   *    - 分段控件 + 滑杆调倍速
   *    - 深色模式自动适配（prefers-color-scheme）
   * ================================================================== */
  const SPEEDS = [1, 1.5, 2, 3, 4, 8, 16, 32];

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const GUI = {
    root: null,
    panel: null,
    fab: null,
    isOpen: false,

    /* ------------------------------------------------------------ 构建 */
    init() {
      if (!document.body) return;
      if (this.root) { try { this.root.remove(); } catch (e) {} }

      this.injectStyle();

      const root = el('div', 'ewt-root');
      root.appendChild(this.makeFab());
      root.appendChild(this.makePanel());
      document.body.appendChild(root);
      this.root = root;
      this.panel = root.querySelector('.ewt-panel');
      this.fab = root.querySelector('.ewt-fab');

      this.restorePos();
      this.isOpen = !!CFG.panelOpen;
      this.panel.classList.toggle('open', this.isOpen);
      this.sync();
      this.watchStatus();
    },

    makeFab() {
      const b = el('button', 'ewt-fab');
      b.type = 'button';
      b.title = '升学E网通助手';
      b.innerHTML = '<span class="ewt-fab-face">🐋</span><i class="ewt-fab-ring"></i>';
      b.addEventListener('click', () => this.toggle());
      return b;
    },

    makePanel() {
      const p = el('div', 'ewt-panel');

      /* 头部 */
      const head = el('div', 'ewt-head');
      head.appendChild(el('div', 'ewt-logo', '🐋'));
      const titleWrap = el('div', 'ewt-titlewrap');
      titleWrap.appendChild(el('h1', 'ewt-title', '升学E网通助手'));
      titleWrap.appendChild(el('span', 'ewt-sub', '自动连播 · 过检 · 跳题 · 倍速'));
      head.appendChild(titleWrap);
      const close = el('button', 'ewt-icon-btn', '✕');
      close.type = 'button';
      close.title = '收起（Esc）';
      close.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(false); });
      head.appendChild(close);
      head.addEventListener('pointerdown', (e) => this.startDrag(e));
      p.appendChild(head);

      /* 主体 */
      const body = el('div', 'ewt-body');

      const status = el('div', 'ewt-status');
      status.appendChild(el('i', 'ewt-dot'));
      const statusText = el('span', 'ewt-status-text', '待机中…');
      statusText.id = 'ewt-status';
      status.appendChild(statusText);
      body.appendChild(status);

      body.appendChild(this.sec('总开关', [this.row('全部自动化', 'enabled', null, true)]));

      body.appendChild(this.sec('倍速', [
        this.speedChips(),
        this.speedSlider(),
        this.row('强制倍速锁定', 'forceSpeed'),
        this.row('超限补帧', 'boostSeek', '浏览器上限 16x，超过的靠跳进补'),
        this.row('静音播放', 'mute', '高倍速时建议打开')
      ]));

      const nextSeg = this.seg(
        [['ended', '播完切换'], ['progress85', '85% 切换']],
        () => CFG.nextMode,
        (v) => { CFG.nextMode = v; saveCfg(); Log.line('连播模式：' + (v === 'ended' ? '播完切换' : '85% 切换')); }
      );
      const ansSel = this.select(
        [['auto', '智能（优先找正确项）'], ['first', '永远选第一个'], ['random', '随机选'], ['longest', '选最长的']],
        () => CFG.answerStrategy,
        (v) => { CFG.answerStrategy = v; saveCfg(); Log.line('答题策略：' + v); }
      );
      body.appendChild(this.sec('自动化', [
        this.row('自动连播', 'autoNext'),
        nextSeg,
        this.row('自动跳过选择题', 'autoSkip'),
        ansSel,
        this.row('自动过认真度检查', 'autoCheck'),
        this.row('防暂停（自动恢复）', 'autoResume')
      ]));

      body.appendChild(this.sec('其它', [
        this.row('后台保活', 'keepAlive', '伪造页面可见性，切标签不掉'),
        this.row('锁定进度条', 'lockProgress', '防止误拖动'),
        this.row('详细日志', 'debug', '输出 [EWT] 调试信息')
      ]));

      const tip = el('div', 'ewt-tip');
      tip.innerHTML = '设置自动保存 · <b>Esc</b> 收起 · 拖动标题栏可移动';
      body.appendChild(tip);

      p.appendChild(body);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) this.toggle(false);
      });
      return p;
    },

    /* ------------------------------------------------------- 小组件工厂 */
    sec(title, children) {
      const s = el('section', 'ewt-sec');
      s.appendChild(el('div', 'ewt-sec-title', title));
      const card = el('div', 'ewt-card');
      children.forEach((c) => card.appendChild(c));
      s.appendChild(card);
      return s;
    },

    row(label, key, hint, master) {
      const r = el('div', 'ewt-row' + (master ? ' ewt-master' : ''));
      const box = el('div', 'ewt-rowtext');
      box.appendChild(el('div', 'ewt-label', label));
      if (hint) box.appendChild(el('div', 'ewt-hint', hint));
      r.appendChild(box);

      const sw = el('label', 'ewt-sw');
      const input = el('input');
      input.type = 'checkbox';
      input.id = 'ewt-toggle-' + key;
      input.checked = !!CFG[key];
      input.addEventListener('change', () => {
        CFG[key] = input.checked;
        saveCfg();
        if (key === 'lockProgress') ProgressLock.toggle(input.checked);
        if (key === 'keepAlive' && input.checked) KeepAlive.install();
        if (key === 'forceSpeed') ForceSpeed.apply();
        if (key === 'enabled') this.refreshFab();
        Log.line(label + '：' + (input.checked ? '开' : '关'));
      });
      sw.appendChild(input);
      sw.appendChild(el('i'));
      r.appendChild(sw);
      return r;
    },

    speedChips() {
      const wrap = el('div', 'ewt-chips');
      SPEEDS.forEach((s) => {
        const b = el('button', 'ewt-chip', s + 'x');
        b.type = 'button';
        b.dataset.speed = String(s);
        b.addEventListener('click', () => this.setSpeed(s));
        wrap.appendChild(b);
      });
      return wrap;
    },

    speedSlider() {
      const wrap = el('div', 'ewt-slider-wrap');
      const range = el('input', 'ewt-range');
      range.type = 'range';
      range.min = '0.5';
      range.max = '32';
      range.step = '0.5';
      range.value = String(CFG.speed);
      range.id = 'ewt-speed-range';
      const val = el('span', 'ewt-slider-val', this.fmt(CFG.speed));
      val.id = 'ewt-speed-val';
      const paint = () => {
        const pct = ((range.value - 0.5) / (32 - 0.5)) * 100;
        range.style.setProperty('--fill', pct.toFixed(1) + '%');
        val.textContent = this.fmt(range.value);
      };
      range.addEventListener('input', () => { paint(); this.setSpeed(Number(range.value), true); });
      paint();
      wrap.appendChild(range);
      wrap.appendChild(val);
      return wrap;
    },

    seg(items, get, set) {
      const wrap = el('div', 'ewt-seg');
      items.forEach(([v, label]) => {
        const b = el('button', 'ewt-seg-item', label);
        b.type = 'button';
        b.dataset.value = v;
        b.addEventListener('click', () => {
          set(v);
          Array.from(wrap.children).forEach((c) => c.classList.toggle('active', c.dataset.value === v));
        });
        b.classList.toggle('active', get() === v);
        wrap.appendChild(b);
      });
      return wrap;
    },

    select(items, get, set) {
      const wrap = el('div', 'ewt-select-wrap');
      const s = el('select', 'ewt-select');
      items.forEach(([v, label]) => {
        const o = el('option', null, label);
        o.value = v;
        if (get() === v) o.selected = true;
        s.appendChild(o);
      });
      s.addEventListener('change', () => set(s.value));
      wrap.appendChild(s);
      return wrap;
    },

    /* ------------------------------------------------------------ 交互 */
    setSpeed(v, fromSlider) {
      const s = Math.max(0.5, Math.min(64, Number(v) || 1));
      CFG.speed = s;
      saveCfg();
      const range = this.panel && this.panel.querySelector('#ewt-speed-range');
      if (range && !fromSlider) {
        range.value = String(s);
        range.dispatchEvent(new Event('input'));
      }
      const val = this.panel && this.panel.querySelector('#ewt-speed-val');
      if (val) val.textContent = this.fmt(s);
      Array.from(this.panel.querySelectorAll('.ewt-chip')).forEach((c) => {
        c.classList.toggle('active', Number(c.dataset.speed) === s);
      });
      ForceSpeed.apply();
      Log.line('倍速已设为 ' + this.fmt(s));
    },

    fmt(v) {
      const n = Number(v);
      return (Number.isInteger(n) ? n : n.toFixed(1)) + ' ×';
    },

    toggle(force) {
      this.isOpen = force === undefined ? !this.isOpen : !!force;
      CFG.panelOpen = this.isOpen;
      saveCfg();
      this.panel.classList.toggle('open', this.isOpen);
    },

    // 宿主（Electron 菜单 / 安卓按钮）改完 CFG 后调它刷新界面
    sync() {
      if (!this.panel) return;
      Object.keys(CFG).forEach((k) => {
        const input = this.panel.querySelector('#ewt-toggle-' + k);
        if (input) input.checked = !!CFG[k];
      });
      const range = this.panel.querySelector('#ewt-speed-range');
      if (range) { range.value = String(CFG.speed); range.dispatchEvent(new Event('input')); }
      const seg = this.panel.querySelector('.ewt-seg');
      if (seg) Array.from(seg.children).forEach((c) => c.classList.toggle('active', c.dataset.value === CFG.nextMode));
      const sel = this.panel.querySelector('.ewt-select');
      if (sel) sel.value = CFG.answerStrategy;
      this.refreshFab();
    },

    refreshFab() {
      if (!this.fab) return;
      this.fab.classList.toggle('on', !!CFG.enabled);
      this.fab.title = '升学E网通助手 · ' + (CFG.enabled ? '运行中' : '已暂停');
    },

    // 状态行：总开关开时小圆点变绿发光
    watchStatus() {
      if (!this.panel) return;
      const status = this.panel.querySelector('.ewt-status');
      const upd = () => status.classList.toggle('on', !!CFG.enabled);
      upd();
      setInterval(upd, 1200);
    },

    /* ------------------------------------------------------- 拖动 & 记忆 */
    startDrag(e) {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      e.preventDefault();
      const r = this.root.getBoundingClientRect();
      const offX = e.clientX - r.left;
      const offY = e.clientY - r.top;
      const move = (ev) => {
        const x = Math.min(Math.max(0, ev.clientX - offX), window.innerWidth - r.width);
        const y = Math.min(Math.max(0, ev.clientY - offY), window.innerHeight - r.height);
        Object.assign(this.root.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        const rr = this.root.getBoundingClientRect();
        CFG.panelPos = { x: Math.round(rr.left), y: Math.round(rr.top) };
        saveCfg();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    },

    restorePos() {
      const p = CFG.panelPos;
      if (!p || typeof p.x !== 'number') return;
      const x = Math.min(Math.max(0, p.x), window.innerWidth - 80);
      const y = Math.min(Math.max(0, p.y), window.innerHeight - 80);
      Object.assign(this.root.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    },

    /* ------------------------------------------------------------- 样式 */
    injectStyle() {
      if (document.getElementById('ewt-style')) return;
      const st = document.createElement('style');
      st.id = 'ewt-style';
      st.textContent = `
.ewt-root{
  position:fixed;right:20px;bottom:20px;z-index:2147483000;
  --accent:#5b6cff;--accent2:#8b5cf6;--ok:#12b981;
  --text:#1f2430;--muted:#8a90a2;--card:#ffffff;--chip:#eef0f7;--line:#eceef5;--panelbg:rgba(255,255,255,.94);
  font:13px/1.55 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;
  color:var(--text);-webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme:dark){
  .ewt-root{--text:#e8eaf3;--muted:#9aa0b4;--card:#22263a;--chip:#2c3149;--line:#333a55;--panelbg:rgba(28,32,48,.95);}
}
.ewt-root *{box-sizing:border-box;}

/* 悬浮球 */
.ewt-fab{
  position:relative;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;padding:0;
  background:linear-gradient(135deg,#7c88ff,#a78bfa);color:#fff;
  box-shadow:0 10px 26px rgba(91,108,255,.40),0 2px 6px rgba(0,0,0,.14);
  transition:transform .22s cubic-bezier(.34,1.56,.64,1),box-shadow .22s,background .3s;
}
.ewt-fab:hover{transform:translateY(-2px) scale(1.06);}
.ewt-fab:active{transform:scale(.94);}
.ewt-fab-face{font-size:26px;line-height:56px;display:block;}
.ewt-fab.on{background:linear-gradient(135deg,#12b981,#0ea5a4);box-shadow:0 10px 26px rgba(18,185,129,.42),0 2px 6px rgba(0,0,0,.14);}
.ewt-fab-ring{position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(91,108,255,.5);opacity:0;pointer-events:none;}
.ewt-fab.on .ewt-fab-ring{animation:ewt-pulse 2.6s ease-out infinite;border-color:rgba(18,185,129,.55);}
@keyframes ewt-pulse{0%{transform:scale(.86);opacity:.85}70%{transform:scale(1.28);opacity:0}100%{transform:scale(1.28);opacity:0}}

/* 面板 */
.ewt-panel{
  position:absolute;right:0;bottom:70px;width:326px;max-height:min(78vh,760px);overflow:auto;
  border-radius:18px;background:var(--panelbg);backdrop-filter:blur(16px) saturate(1.4);
  border:1px solid rgba(255,255,255,.5);
  box-shadow:0 22px 60px rgba(20,28,60,.26),0 2px 8px rgba(20,28,60,.10);
  opacity:0;transform:translateY(10px) scale(.98);pointer-events:none;
  transition:opacity .2s ease,transform .24s cubic-bezier(.34,1.4,.64,1);
}
.ewt-panel.open{opacity:1;transform:none;pointer-events:auto;}
.ewt-panel::-webkit-scrollbar{width:8px;}
.ewt-panel::-webkit-scrollbar-thumb{background:rgba(140,148,180,.45);border-radius:8px;border:2px solid transparent;background-clip:content-box;}
.ewt-panel::-webkit-scrollbar-track{background:transparent;}

/* 头部 */
.ewt-head{
  position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;
  padding:13px 14px 12px;border-radius:18px 18px 0 0;cursor:grab;user-select:none;
  background:linear-gradient(135deg,#6d7cff,#a78bfa);color:#fff;
}
.ewt-head:active{cursor:grabbing;}
.ewt-logo{width:32px;height:32px;border-radius:11px;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:18px;flex:0 0 auto;}
.ewt-titlewrap{flex:1;min-width:0;}
.ewt-title{margin:0;font-size:14px;font-weight:600;letter-spacing:.2px;line-height:1.2;}
.ewt-sub{font-size:10.5px;opacity:.82;}
.ewt-icon-btn{
  width:26px;height:26px;border-radius:9px;border:0;cursor:pointer;flex:0 0 auto;
  background:rgba(255,255,255,.18);color:#fff;font-size:12px;line-height:1;transition:background .18s;
}
.ewt-icon-btn:hover{background:rgba(255,255,255,.32);}

/* 主体 */
.ewt-body{padding:12px 13px 14px;}
.ewt-status{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:12px;margin-bottom:12px;
  background:linear-gradient(135deg,rgba(91,108,255,.10),rgba(167,139,250,.10));font-size:11.5px;}
.ewt-dot{width:7px;height:7px;border-radius:50%;background:#c4cad8;flex:0 0 auto;transition:.3s;}
.ewt-status.on .ewt-dot{background:var(--ok);box-shadow:0 0 0 4px rgba(18,185,129,.16);}
.ewt-status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.ewt-sec{margin-top:13px;}
.ewt-sec-title{font-size:10.5px;font-weight:700;letter-spacing:1px;color:var(--muted);margin:0 0 7px 4px;}
.ewt-card{background:var(--card);border-radius:14px;padding:3px 12px;box-shadow:0 1px 3px rgba(20,28,60,.05);}
.ewt-row{display:flex;align-items:center;gap:10px;padding:9px 0;}
.ewt-row + .ewt-row{border-top:1px solid var(--line);}
.ewt-rowtext{flex:1;min-width:0;}
.ewt-label{font-size:12.5px;}
.ewt-hint{font-size:10.5px;color:var(--muted);margin-top:1px;}
.ewt-master .ewt-label{font-weight:600;color:var(--accent);}

/* 开关 */
.ewt-sw{position:relative;flex:0 0 auto;width:42px;height:24px;display:block;}
.ewt-sw input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:2;}
.ewt-sw i{position:absolute;inset:0;border-radius:999px;background:#d6dae6;transition:background .26s;display:block;}
.ewt-sw i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .26s cubic-bezier(.34,1.56,.64,1);}
.ewt-sw input:checked + i{background:linear-gradient(135deg,var(--accent),var(--accent2));}
.ewt-sw input:checked + i::after{transform:translateX(18px);}
.ewt-sw input:focus-visible + i{outline:2px solid rgba(91,108,255,.5);outline-offset:2px;}

/* 倍速 */
.ewt-chips{display:flex;flex-wrap:wrap;gap:6px;padding:11px 0 2px;}
.ewt-chip{flex:1 0 21%;padding:6px 0;border:0;border-radius:10px;cursor:pointer;font-size:12px;
  background:var(--chip);color:var(--text);transition:background .16s,color .16s,box-shadow .16s;}
.ewt-chip:hover{background:#e2e6f5;}
@media (prefers-color-scheme:dark){.ewt-chip:hover{background:#3a4160;}}
.ewt-chip.active{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;
  box-shadow:0 5px 14px rgba(91,108,255,.38);}
.ewt-slider-wrap{display:flex;align-items:center;gap:10px;padding:4px 0 10px;border-bottom:1px solid var(--line);}
.ewt-range{flex:1;-webkit-appearance:none;appearance:none;height:20px;background:transparent;cursor:pointer;}
.ewt-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;
  background:linear-gradient(90deg,var(--accent),var(--accent2)) 0/var(--fill,12%) 100% no-repeat,var(--chip);}
.ewt-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:50%;
  background:#fff;border:2px solid var(--accent);box-shadow:0 1px 4px rgba(0,0,0,.28);}
.ewt-range::-moz-range-track{height:6px;border-radius:999px;background:var(--chip);}
.ewt-range::-moz-range-progress{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2));}
.ewt-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid var(--accent);}
.ewt-slider-val{flex:0 0 auto;font-size:12px;font-weight:600;color:var(--accent);min-width:44px;text-align:right;}

/* 分段控件 / 下拉 */
.ewt-seg{display:flex;gap:4px;padding:9px 0;border-top:1px solid var(--line);}
.ewt-seg-item{flex:1;padding:6px 0;border:0;border-radius:9px;cursor:pointer;font-size:11.5px;
  background:var(--chip);color:var(--text);transition:.16s;}
.ewt-seg-item.active{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;
  box-shadow:0 4px 12px rgba(91,108,255,.32);}
.ewt-select-wrap{padding:9px 0;border-top:1px solid var(--line);}
.ewt-select{width:100%;padding:7px 9px;border-radius:10px;border:1px solid var(--line);font-size:12px;
  background:var(--chip);color:var(--text);outline:none;cursor:pointer;}
.ewt-select:focus{border-color:var(--accent);}

.ewt-tip{margin-top:12px;font-size:10.5px;color:var(--muted);text-align:center;line-height:1.6;}
.ewt-tip b{color:var(--accent);}
`;
      (document.head || document.documentElement).appendChild(st);
    }
  };

  /* ==================================================================
   * 9. 启动
   * ================================================================== */
  // 立即装载：倍速劫持必须抢在站点脚本之前（document-start 友好）
  ForceSpeed.install();
  ForceSpeed.startTimers();

  function boot() {
    ForceSpeed.install();
    ForceSpeed.startTimers();
    AutoNext.start();
    AutoSkip.start();
    AutoCheck.start();
    if (CFG.keepAlive) KeepAlive.install();
    if (CFG.lockProgress) ProgressLock.toggle(true);
    GUI.init();
    // 暴露给宿主（Electron / WebView 桌面壳、安卓壳）调用
    try {
      window.__EWT = {
        CFG: CFG, save: saveCfg, on: on,
        ForceSpeed: ForceSpeed, AutoNext: AutoNext, AutoSkip: AutoSkip, AutoCheck: AutoCheck, GUI: GUI
      };
    } catch (e) {}
    console.log('[EWT] 升学E网通助手 v4 已启动，点击右下角 🐋 打开面板');
  }

  let retry = 0;
  function tryBoot() {
    if (document.body) { try { boot(); } catch (e) { Log.err('启动异常', e); } return; }
    if (retry++ < 60) setTimeout(tryBoot, 300);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') tryBoot();
  else document.addEventListener('DOMContentLoaded', tryBoot);

  // SPA 路由切换后面板丢了就补回来（document-start 时 documentElement 可能还不存在）
  (function watchSpa() {
    const check = () => {
      if (document.body && GUI.root && !document.querySelector('.ewt-root')) GUI.init();
    };
    if (document.documentElement) {
      new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: false });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: false });
      }, { once: true });
    }
  })();
})();

