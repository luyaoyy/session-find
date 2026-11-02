/**
 * Client half of the session-find bundle.
 *
 * Ctrl+F opens a Notepad-style find bar in the frame-wide overlay layer. The bar
 * scans the text currently rendered for the open session, highlights every hit
 * in place with the CSS Custom Highlight API, and walks the hits with
 * Enter / Shift+Enter (or the previous/next buttons). Escape closes it.
 *
 * The scan can be narrowed to one side of the conversation: everything, only
 * the user's own input, or only what the assistant produced. Tab / Shift+Tab
 * cycle that scope, and the same three choices are on the bar itself.
 *
 * The scan is deliberately limited to what the Session view has rendered: the
 * bar never reads session events, never writes into another component's DOM and
 * never mounts anything outside its own overlay entry.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-find',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-session-find';
    const ROOT_ATTR = 'data-dsh-session-find';
    const HL_ALL = 'dsh-session-find-all';
    const HL_CURRENT = 'dsh-session-find-current';

    const MAX_MATCHES = 2000;
    const MAX_SCANNED_CHARS = 2000000;
    const QUERY_DEBOUNCE = 90;
    const LIVE_DEBOUNCE = 250;

    // Scopes, in the order Tab cycles them.
    const SCOPE_ALL = 'all';
    const SCOPE_USER = 'user';
    const SCOPE_AI = 'ai';
    const SCOPE_ORDER = [SCOPE_ALL, SCOPE_USER, SCOPE_AI];

    // The Chat view tags every transcript row with the kind of node it renders.
    // That attribute is the only way to tell the user's own words from the
    // assistant's without reading session data, so a region without it keeps
    // the scoped modes disabled instead of silently reporting zero hits.
    const KIND_ATTR = 'data-chat-flow-kind';
    const USER_KINDS = new Set(['user', 'steering']);
    const AI_KINDS = new Set([
      'assistant-step', 'turn-process', 'tool-call', 'model-retry',
      'turn-error', 'turn-max-tokens', 'compaction', 'manual-compaction',
    ]);

    const SKIP_TAGS = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT',
      'SELECT', 'OPTION', 'BUTTON', 'IFRAME', 'OBJECT', 'CANVAS',
      'AUDIO', 'VIDEO',
    ]);
    const WORD_CHAR = /[\p{L}\p{N}_]/u;

    const EN = {
      title: 'Find in current session',
      placeholder: 'Find in current session',
      previous: 'Previous match (Shift+Enter)',
      next: 'Next match (Enter)',
      matchCase: 'Match case (Alt+C)',
      wholeWord: 'Match whole word (Alt+W)',
      close: 'Close (Esc)',
      noResults: 'No results',
      dragHint: 'Drag to move, double-click to reset',
      scopeGroup: 'Search scope',
      scopeAll: 'All',
      scopeAllTitle: 'Search the whole session (Tab switches scope)',
      scopeUser: 'Me',
      scopeUserTitle: 'Search only what you sent (Tab switches scope)',
      scopeAi: 'AI',
      scopeAiTitle: 'Search only what the assistant produced (Tab switches scope)',
      scopeUnavailable: 'This view does not distinguish message sources',
    };
    const ZH = {
      title: '在当前会话中查找',
      placeholder: '在当前会话中查找',
      previous: '上一个匹配（Shift+Enter）',
      next: '下一个匹配（Enter）',
      matchCase: '区分大小写（Alt+C）',
      wholeWord: '全字匹配（Alt+W）',
      close: '关闭（Esc）',
      noResults: '无结果',
      dragHint: '按住拖动查找条，双击复位',
      scopeGroup: '搜索范围',
      scopeAll: '全部',
      scopeAllTitle: '搜索整个会话（Tab 切换范围）',
      scopeUser: '我',
      scopeUserTitle: '只搜索我发送的内容（Tab 切换范围）',
      scopeAi: 'AI',
      scopeAiTitle: '只搜索 AI 的输出（Tab 切换范围）',
      scopeUnavailable: '当前视图没有可区分来源的消息',
    };
    // Label and tooltip keys per scope, so the bar can render from SCOPE_ORDER.
    const SCOPE_TEXT = {
      all: { label: 'scopeAll', title: 'scopeAllTitle' },
      user: { label: 'scopeUser', title: 'scopeUserTitle' },
      ai: { label: 'scopeAi', title: 'scopeAiTitle' },
    };

    const STYLE_TEXT = [
      '.dsf-root { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1; pointer-events: auto; }',
      '.dsf-bar { display: flex; align-items: center; gap: 4px; box-sizing: border-box;',
      '  min-width: 430px; max-width: min(560px, calc(100vw - 40px)); padding: 5px 6px 5px 9px;',
      '  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;',
      '  background: var(--dsw-alias-bg-overlay);',
      '  box-shadow: 0 10px 26px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);',
      '  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }',
      '.dsf-bar:focus-within { border-color: var(--dsw-alias-brand-primary); }',
      '.dsf-bar { cursor: grab; touch-action: none; }',
      '.dsf-dragging, .dsf-dragging * { cursor: grabbing !important; user-select: none !important; }',
      '.dsf-icon { flex: none; color: var(--dsw-alias-label-secondary); cursor: grab; }',
      '.dsf-input { flex: 1 1 auto; min-width: 0; margin: 0; padding: 2px 3px; border: 0; outline: 0; cursor: text;',
      '  background: transparent; color: inherit; font: inherit; }',
      '.dsf-input::placeholder { color: var(--dsw-alias-label-secondary); }',
      '.dsf-count { flex: none; padding: 0 2px; color: var(--dsw-alias-label-secondary);',
      '  font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.dsf-count-empty { color: var(--dsw-alias-state-error-primary); }',
      '.dsf-scope { display: inline-flex; flex: none; align-items: center; gap: 2px; padding: 2px;',
      '  border-radius: 7px; background: var(--dsw-alias-bg-layer-2); }',
      '.dsf-scope-btn { flex: none; min-width: 28px; height: 20px; margin: 0; padding: 0 5px; border: 0;',
      '  border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary);',
      '  font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; white-space: nowrap; }',
      '.dsf-scope-btn:hover:not(:disabled):not(.dsf-scope-on) { color: var(--dsw-alias-label-primary); }',
      '.dsf-scope-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.dsf-scope-btn:disabled { opacity: 0.4; cursor: default; }',
      '.dsf-scope-on { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-brand-primary);',
      '  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }',
      '.dsf-btn { display: inline-flex; flex: none; align-items: center; justify-content: center;',
      '  width: 24px; height: 24px; margin: 0; padding: 0; border: 0; border-radius: 6px;',
      '  background: transparent; color: var(--dsw-alias-label-secondary);',
      '  font: inherit; font-size: 12px; line-height: 1; cursor: pointer; }',
      '.dsf-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }',
      '.dsf-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.dsf-btn:disabled { opacity: 0.4; cursor: default; }',
      '.dsf-btn-on { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }',
      '.dsf-sep { flex: none; width: 1px; height: 16px; margin: 0 2px; background: var(--dsw-alias-border-l1); }',
      '::highlight(' + HL_ALL + ') {',
      '  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent); }',
      '::highlight(' + HL_CURRENT + ') {',
      '  background-color: var(--dsw-alias-brand-primary);',
      '  color: var(--dsw-alias-bg-base); }',
    ].join('\n');

    let localeService = null;
    let translate = function (key) {
      return EN[key] || key;
    };

    /* ------------------------------------------------------------------ */
    /* DOM helpers                                                        */
    /* ------------------------------------------------------------------ */

    function clampPosition(x, y, width, height) {
      const margin = 8;
      const viewWidth = window.innerWidth || 0;
      const viewHeight = window.innerHeight || 0;
      const maxX = Math.max(margin, viewWidth - width - margin);
      const maxY = Math.max(margin, viewHeight - height - margin);
      return {
        x: Math.min(Math.max(margin, x), maxX),
        y: Math.min(Math.max(margin, y), maxY),
      };
    }

    function isInteractiveTarget(node) {
      if (!node || typeof node.closest !== 'function') return false;
      return Boolean(node.closest('input, textarea, select, button, a, [role="button"]'));
    }

    function isOwnNode(node) {
      if (!node || typeof node.closest !== 'function') return false;
      return Boolean(node.closest('[' + ROOT_ATTR + ']'));
    }

    function probeElement(viewWidth, viewHeight, fractionX, fractionY) {
      if (typeof document.elementFromPoint !== 'function') return null;
      let node = null;
      try {
        node = document.elementFromPoint(
          Math.round(viewWidth * fractionX),
          Math.round(viewHeight * fractionY),
        );
      } catch (error) {
        return null;
      }
      if (!node) return null;
      if (node === document.body || node === document.documentElement) return null;
      if (isOwnNode(node)) return null;
      return node;
    }

    /**
     * Climb from an element found in the content column to the widest ancestor
     * that is still a column rather than the whole frame. That ancestor is the
     * Session view (chat area plus header), which is what "current session"
     * means for the user. The upper bound keeps the app shell, which also
     * contains the sidebar, out of the search scope.
     */
    function columnAround(node, viewportArea) {
      let best = null;
      let current = node;
      for (let depth = 0; current && depth < 40; depth += 1) {
        if (current === document.body || current === document.documentElement) break;
        if (isOwnNode(current)) break;
        let rect = null;
        try {
          rect = current.getBoundingClientRect();
        } catch (error) {
          break;
        }
        if (rect) {
          const area = rect.width * rect.height;
          if (area >= viewportArea * 0.3 && area <= viewportArea * 0.92) best = current;
        }
        current = current.parentElement;
      }
      return best;
    }

    function largestScrollRegion(viewWidth, viewHeight) {
      const body = document.body;
      if (!body) return null;
      let nodes = [];
      try {
        nodes = body.getElementsByTagName('*');
      } catch (error) {
        return null;
      }
      let best = null;
      let bestArea = 0;
      const limit = Math.min(nodes.length, 6000);
      for (let index = 0; index < limit; index += 1) {
        const node = nodes[index];
        if (isOwnNode(node)) continue;
        if (node.scrollHeight <= node.clientHeight + 8) continue;
        let style = null;
        try {
          style = window.getComputedStyle(node);
        } catch (error) {
          continue;
        }
        if (!style) continue;
        if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < viewWidth * 0.3 || rect.height < viewHeight * 0.25) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestArea = area;
          best = node;
        }
      }
      return best;
    }

    function findRegion() {
      const viewWidth = window.innerWidth || 0;
      const viewHeight = window.innerHeight || 0;
      if (!viewWidth || !viewHeight || !document.body) return document.body || null;
      const viewportArea = viewWidth * viewHeight;
      const probes = [
        [0.5, 0.35],
        [0.5, 0.55],
        [0.38, 0.45],
        [0.62, 0.3],
      ];
      for (let index = 0; index < probes.length; index += 1) {
        const probe = probeElement(viewWidth, viewHeight, probes[index][0], probes[index][1]);
        if (!probe) continue;
        const region = columnAround(probe, viewportArea);
        if (region) return region;
      }
      return largestScrollRegion(viewWidth, viewHeight) || document.body || null;
    }

    function isWordBoundary(text, start, end) {
      const before = start > 0 ? text.charAt(start - 1) : '';
      const after = end < text.length ? text.charAt(end) : '';
      return !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
    }

    function shouldAcceptText(parent) {
      if (!parent) return false;
      if (SKIP_TAGS.has(parent.tagName)) return false;
      if (parent.isContentEditable) return false;
      if (typeof parent.closest === 'function') {
        if (parent.closest('[' + ROOT_ATTR + ']')) return false;
        if (parent.closest('[contenteditable=""],[contenteditable="true"],[role="textbox"]')) return false;
      }
      if (typeof parent.checkVisibility === 'function') {
        try {
          if (!parent.checkVisibility()) return false;
        } catch (error) {
          /* keep the node when visibility cannot be computed */
        }
      }
      return true;
    }

    /**
     * Resolve which transcript row an element sits in. The Chat view marks every
     * row with the kind of node it renders and rows never nest inside each
     * other, so the nearest marked ancestor is the row itself. Ancestors are
     * cached per scan, which keeps a session-wide scan at one attribute read
     * per distinct element instead of one walk per text node.
     */
    function createKindResolver(region) {
      const cache = new WeakMap();
      return function kindOf(element) {
        const walked = [];
        let current = element;
        let kind = null;
        while (current && current.nodeType === 1) {
          if (cache.has(current)) {
            kind = cache.get(current);
            break;
          }
          const attribute = current.getAttribute(KIND_ATTR);
          if (attribute) {
            kind = attribute;
            cache.set(current, kind);
            break;
          }
          walked.push(current);
          if (current === region || current === document.body) break;
          current = current.parentElement;
        }
        for (let index = 0; index < walked.length; index += 1) cache.set(walked[index], kind);
        return kind;
      };
    }

    function matchesScope(kind, scope) {
      if (scope === SCOPE_USER) return kind !== null && USER_KINDS.has(kind);
      if (scope === SCOPE_AI) return kind !== null && AI_KINDS.has(kind);
      return true;
    }

    /**
     * Whether the rendered region can be split by source at all. Another view,
     * or a host version without row kinds, would make the scoped modes report
     * "no results" forever, so the bar greys them out and keeps searching
     * everything instead of pretending to filter.
     */
    function regionSplitsBySource(region) {
      if (!region || typeof region.querySelector !== 'function') return false;
      try {
        return Boolean(region.querySelector('[' + KIND_ATTR + ']'));
      } catch (error) {
        return false;
      }
    }

    /**
     * Collect hits inside the rendered region. Matches never span two text
     * nodes, which mirrors what a plain per-node scan can promise: text split
     * across inline markup is not stitched back together.
     */
    function collectMatches(region, query, caseSensitive, wholeWord, scope) {
      const matches = [];
      if (!region || !query) return matches;
      if (typeof document.createTreeWalker !== 'function') return matches;
      const needle = caseSensitive ? query : query.toLowerCase();
      if (!needle) return matches;
      // An unscoped scan reads no row kinds at all, so the default stays as
      // cheap as it was before scopes existed.
      const kindOf = scope === SCOPE_ALL ? null : createKindResolver(region);
      let walker = null;
      try {
        walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (!shouldAcceptText(node.parentElement)) return NodeFilter.FILTER_REJECT;
            if (kindOf && !matchesScope(kindOf(node.parentElement), scope)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
      } catch (error) {
        return matches;
      }
      let scanned = 0;
      let node = walker.nextNode();
      while (node) {
        const text = node.nodeValue;
        scanned += text.length;
        if (scanned > MAX_SCANNED_CHARS) break;
        const haystack = caseSensitive ? text : text.toLowerCase();
        let from = 0;
        while (matches.length < MAX_MATCHES) {
          const at = haystack.indexOf(needle, from);
          if (at < 0) break;
          const end = at + needle.length;
          if (!wholeWord || isWordBoundary(text, at, end)) {
            matches.push({ node: node, start: at, end: end, el: node.parentElement });
            if (matches.length >= MAX_MATCHES) break;
          }
          from = at + Math.max(1, needle.length);
        }
        if (matches.length >= MAX_MATCHES) break;
        node = walker.nextNode();
      }
      return matches;
    }

    /* ------------------------------------------------------------------ */
    /* Highlighting                                                       */
    /* ------------------------------------------------------------------ */

    function supportsHighlights() {
      return typeof CSS !== 'undefined'
        && Boolean(CSS)
        && Boolean(CSS.highlights)
        && typeof Highlight === 'function'
        && typeof document.createRange === 'function';
    }

    function clearHighlights() {
      if (!supportsHighlights()) return;
      try {
        CSS.highlights.delete(HL_ALL);
        CSS.highlights.delete(HL_CURRENT);
      } catch (error) {
        /* registry unavailable after teardown */
      }
    }

    function paint(matches, index) {
      if (!supportsHighlights()) return;
      try {
        const ranges = [];
        let currentRange = null;
        for (let cursor = 0; cursor < matches.length; cursor += 1) {
          const match = matches[cursor];
          if (!match.node || !match.node.isConnected) continue;
          const range = document.createRange();
          range.setStart(match.node, match.start);
          range.setEnd(match.node, match.end);
          ranges.push(range);
          if (cursor === index) currentRange = range;
        }
        if (!ranges.length) {
          clearHighlights();
          return;
        }
        CSS.highlights.set(HL_ALL, new Highlight(...ranges));
        if (currentRange) CSS.highlights.set(HL_CURRENT, new Highlight(currentRange));
        else CSS.highlights.delete(HL_CURRENT);
      } catch (error) {
        clearHighlights();
      }
    }

    function reveal(match) {
      if (!match || !match.el || !match.el.isConnected) return;
      try {
        match.el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (error) {
        /* non-scrollable regions simply stay put */
      }
    }

    function focusInput(input) {
      if (!input) return;
      try {
        input.focus();
        input.select();
      } catch (error) {
        /* focus can be refused while the page is not interactive */
      }
    }

    /* ------------------------------------------------------------------ */
    /* Component                                                          */
    /* ------------------------------------------------------------------ */

    function useLocaleRevision() {
      const pair = React.useState(0);
      const bump = pair[1];
      React.useEffect(function () {
        if (!localeService || typeof localeService.subscribe !== 'function') return undefined;
        return localeService.subscribe(function () {
          bump(function (value) {
            return value + 1;
          });
        });
      }, []);
    }

    function FindBar() {
      const openState = React.useState(false);
      const open = openState[0];
      const setOpen = openState[1];

      const queryState = React.useState('');
      const query = queryState[0];
      const setQuery = queryState[1];

      const caseState = React.useState(false);
      const caseSensitive = caseState[0];
      const setCaseSensitive = caseState[1];

      const wordState = React.useState(false);
      const wholeWord = wordState[0];
      const setWholeWord = wordState[1];

      const scopeState = React.useState(SCOPE_ALL);
      const scope = scopeState[0];
      const setScope = scopeState[1];

      // Optimistic until the first scan reports what the rendered region can
      // actually tell apart, so the control does not flicker on every open.
      const scopeReadyState = React.useState(true);
      const scopeReady = scopeReadyState[0];
      const setScopeReady = scopeReadyState[1];

      const totalState = React.useState(0);
      const total = totalState[0];
      const setTotal = totalState[1];

      const activeState = React.useState(0);
      const active = activeState[0];
      const setActive = activeState[1];

      const rootRef = React.useRef(null);
      const barRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const openRef = React.useRef(false);
      const dragRef = React.useRef(null);
      const lastDownRef = React.useRef(0);
      const posRef = React.useRef(null);
      const posState = React.useState(null);
      const pos = posState[0];
      const setPos = posState[1];
      const dragState = React.useState(false);
      const dragging = dragState[0];
      const setDragging = dragState[1];
      const model = React.useRef({
        matches: [],
        region: null,
        widened: false,
        index: 0,
        queryTimer: 0,
        liveTimer: 0,
        lastKey: null,
      });
      const params = React.useRef({ query: '', caseSensitive: false, wholeWord: false, scope: SCOPE_ALL });
      const scanRef = React.useRef(null);
      const moveRef = React.useRef(null);

      useLocaleRevision();

      params.current = {
        query: query,
        caseSensitive: caseSensitive,
        wholeWord: wholeWord,
        scope: scope,
      };
      openRef.current = open;
      posRef.current = pos;

      scanRef.current = function scanMatches(options) {
        const reset = Boolean(options && options.reset);
        const scroll = Boolean(options && options.scroll);
        const currentParams = params.current;
        const state = model.current;
        clearHighlights();
        if (!state.region || !state.region.isConnected) {
          state.region = findRegion();
          state.widened = false;
        }
        // A region that carries no row kinds cannot be split by source; the
        // control says so instead of returning a misleading zero.
        const splittable = regionSplitsBySource(state.region);
        setScopeReady(splittable);
        const activeScope = splittable ? currentParams.scope : SCOPE_ALL;
        if (!currentParams.query) {
          state.matches = [];
          state.index = 0;
          setTotal(0);
          setActive(0);
          return;
        }
        let matches = collectMatches(
          state.region,
          currentParams.query,
          currentParams.caseSensitive,
          currentParams.wholeWord,
          activeScope,
        );
        // The content column detection is a heuristic. If it produced nothing
        // while the page itself contains the phrase, widen the scope to the
        // whole document once instead of reporting a false "no results".
        if (!matches.length && !state.widened && document.body && state.region !== document.body) {
          const widenedMatches = collectMatches(
            document.body,
            currentParams.query,
            currentParams.caseSensitive,
            currentParams.wholeWord,
            activeScope,
          );
          if (widenedMatches.length) {
            state.region = document.body;
            state.widened = true;
            matches = widenedMatches;
          }
        }
        state.matches = matches;
        if (reset) state.index = 0;
        if (state.index >= matches.length) state.index = 0;
        if (!matches.length) {
          setTotal(0);
          setActive(0);
          return;
        }
        setTotal(matches.length);
        setActive(state.index + 1);
        paint(matches, state.index);
        if (scroll) reveal(matches[state.index]);
      };

      moveRef.current = function moveMatch(step) {
        const state = model.current;
        if (!state.matches.length) return;
        state.index = (state.index + step + state.matches.length) % state.matches.length;
        paint(state.matches, state.index);
        setActive(state.index + 1);
        reveal(state.matches[state.index]);
      };

      // Dragging: grab the bar anywhere that is not a control, keep it inside
      // the window, and let a double click snap it back to the default corner.
      // The second press is detected here instead of through `dblclick`
      // because cancelling pointerdown can suppress the compatibility events.
      function onBarPointerDown(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (isInteractiveTarget(event.target)) return;
        const bar = barRef.current;
        if (!bar) return;
        const now = Date.now();
        const repeated = now - lastDownRef.current < 350;
        lastDownRef.current = repeated ? 0 : now;
        if (repeated) {
          dragRef.current = null;
          setDragging(false);
          setPos(null);
          event.preventDefault();
          return;
        }
        const rect = bar.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          width: rect.width,
          height: rect.height,
        };
        setDragging(true);
        setPos({ x: rect.left, y: rect.top });
        try {
          bar.setPointerCapture(event.pointerId);
        } catch (error) {
          /* capture is a nicety; dragging still works without it */
        }
        event.preventDefault();
      }

      function onBarPointerMove(event) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setPos(clampPosition(
          event.clientX - drag.offsetX,
          event.clientY - drag.offsetY,
          drag.width,
          drag.height,
        ));
      }

      function endBarDrag() {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setDragging(false);
        const bar = barRef.current;
        if (!bar) return;
        try {
          bar.releasePointerCapture(drag.pointerId);
        } catch (error) {
          /* already released */
        }
      }

      function onBarDoubleClick(event) {
        if (isInteractiveTarget(event.target)) return;
        setPos(null);
      }

      // Ctrl+F / Cmd+F opens the bar from anywhere; Escape closes it.
      React.useEffect(function () {
        function onKeyDown(event) {
          if (event.defaultPrevented) return;
          const primary = event.ctrlKey || event.metaKey;
          if (primary && !event.altKey && !event.shiftKey && (event.key === 'f' || event.key === 'F')) {
            event.preventDefault();
            event.stopPropagation();
            if (openRef.current) {
              focusInput(inputRef.current);
              return;
            }
            setOpen(true);
            return;
          }
          if (event.key === 'Escape' && openRef.current) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }
        window.addEventListener('keydown', onKeyDown, true);
        return function () {
          window.removeEventListener('keydown', onKeyDown, true);
        };
      }, []);

      React.useEffect(function () {
        if (!open) return undefined;
        const timer = window.setTimeout(function () {
          focusInput(inputRef.current);
        }, 0);
        return function () {
          window.clearTimeout(timer);
        };
      }, [open]);

      // A remembered drag position must stay reachable after the window shrinks.
      React.useEffect(function () {
        if (!open) return undefined;
        function clampCurrent() {
          if (!posRef.current) return;
          const bar = barRef.current;
          if (!bar) return;
          const next = clampPosition(posRef.current.x, posRef.current.y, bar.offsetWidth, bar.offsetHeight);
          if (next.x === posRef.current.x && next.y === posRef.current.y) return;
          setPos(next);
        }
        clampCurrent();
        window.addEventListener('resize', clampCurrent);
        return function () {
          window.removeEventListener('resize', clampCurrent);
        };
      }, [open]);

      // Re-scan whenever the query, a search option or the scope changes.
      React.useEffect(function () {
        if (!open) return undefined;
        const state = model.current;
        const key = query + '\u0000' + (caseSensitive ? 'c' : '-') + (wholeWord ? 'w' : '-') + '\u0000' + scope;
        const changed = state.lastKey !== key;
        state.lastKey = key;
        if (state.queryTimer) window.clearTimeout(state.queryTimer);
        state.queryTimer = window.setTimeout(function () {
          state.queryTimer = 0;
          if (scanRef.current) scanRef.current({ reset: changed, scroll: changed });
        }, QUERY_DEBOUNCE);
        return function () {
          if (state.queryTimer) {
            window.clearTimeout(state.queryTimer);
            state.queryTimer = 0;
          }
        };
      }, [open, query, caseSensitive, wholeWord, scope]);

      // Keep the count honest while the session streams new text in.
      React.useEffect(function () {
        if (!open) return undefined;
        if (typeof MutationObserver !== 'function' || !document.body) return undefined;
        const state = model.current;
        let observer = null;
        try {
          observer = new MutationObserver(function () {
            if (state.liveTimer) return;
            state.liveTimer = window.setTimeout(function () {
              state.liveTimer = 0;
              if (scanRef.current) scanRef.current({ reset: false, scroll: false });
            }, LIVE_DEBOUNCE);
          });
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        } catch (error) {
          observer = null;
        }
        return function () {
          if (observer) observer.disconnect();
          if (state.liveTimer) {
            window.clearTimeout(state.liveTimer);
            state.liveTimer = 0;
          }
        };
      }, [open]);

      // Dropping the bar also drops its highlights and cached region.
      React.useEffect(function () {
        if (open) return;
        const state = model.current;
        state.matches = [];
        state.region = null;
        state.widened = false;
        state.index = 0;
        state.lastKey = null;
        clearHighlights();
        setTotal(0);
        setActive(0);
      }, [open]);

      React.useEffect(function () {
        return function () {
          clearHighlights();
        };
      }, []);

      if (!open) return null;

      const status = !query ? '' : (total === 0 ? translate('noResults') : active + '/' + total);

      function cycleScope(step) {
        setScope(function (value) {
          const index = SCOPE_ORDER.indexOf(value);
          const from = index < 0 ? 0 : index;
          return SCOPE_ORDER[(from + step + SCOPE_ORDER.length) % SCOPE_ORDER.length];
        });
      }

      function onInputKeyDown(event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (moveRef.current) moveRef.current(event.shiftKey ? -1 : 1);
          return;
        }
        // Tab is the fastest way to change scope right after Ctrl+F, which is
        // why it is claimed here rather than left to focus navigation. The two
        // option toggles keep their own Alt shortcuts so a keyboard user still
        // reaches everything the bar offers (see onBarKeyDown). When the view
        // cannot split by source there is nothing to cycle, so Tab stays the
        // ordinary focus move.
        if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
          if (!scopeReady) return;
          event.preventDefault();
          cycleScope(event.shiftKey ? -1 : 1);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }

      function onBarKeyDown(event) {
        if (!event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (key === 'c') {
          event.preventDefault();
          setCaseSensitive(function (value) {
            return !value;
          });
          return;
        }
        if (key === 'w') {
          event.preventDefault();
          setWholeWord(function (value) {
            return !value;
          });
        }
      }

      return h(
        'div',
        {
          className: 'dsf-root',
          ref: rootRef,
          style: pos ? { left: pos.x + 'px', top: pos.y + 'px', transform: 'none' } : null,
          [ROOT_ATTR]: '',
          onMouseDown(event) {
            event.stopPropagation();
          },
        },
        h('style', null, STYLE_TEXT),
        h(
          'div',
          {
            className: 'dsf-bar' + (dragging ? ' dsf-dragging' : ''),
            role: 'search',
            'aria-label': translate('title'),
            ref: barRef,
            onPointerDown: onBarPointerDown,
            onPointerMove: onBarPointerMove,
            onPointerUp: endBarDrag,
            onPointerCancel: endBarDrag,
            onDoubleClick: onBarDoubleClick,
            onKeyDown: onBarKeyDown,
          },
          h(
            'svg',
            {
              className: 'dsf-icon',
              viewBox: '0 0 16 16',
              width: 14,
              height: 14,
              'aria-hidden': true,
            },
            h('title', null, translate('dragHint')),
            h('circle', {
              cx: 7,
              cy: 7,
              r: 4.4,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
            }),
            h('path', {
              d: 'M10.4 10.4 L14 14',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
              strokeLinecap: 'round',
            }),
          ),
          h('input', {
            ref: inputRef,
            className: 'dsf-input',
            type: 'text',
            value: query,
            placeholder: translate('placeholder'),
            'aria-label': translate('placeholder'),
            spellCheck: false,
            autoComplete: 'off',
            onChange(event) {
              setQuery(event.target.value);
            },
            onKeyDown: onInputKeyDown,
          }),
          h(
            'span',
            {
              className: 'dsf-count' + (query && total === 0 ? ' dsf-count-empty' : ''),
              'aria-live': 'polite',
            },
            status,
          ),
          h('span', { className: 'dsf-sep', 'aria-hidden': true }),
          h(
            'div',
            {
              className: 'dsf-scope',
              role: 'group',
              'aria-label': translate('scopeGroup'),
              title: scopeReady ? null : translate('scopeUnavailable'),
            },
            SCOPE_ORDER.map(function (id) {
              const current = scope === id;
              return h(
                'button',
                {
                  key: id,
                  type: 'button',
                  className: 'dsf-scope-btn' + (current ? ' dsf-scope-on' : ''),
                  title: scopeReady ? translate(SCOPE_TEXT[id].title) : translate('scopeUnavailable'),
                  'aria-pressed': current,
                  disabled: !scopeReady,
                  onClick() {
                    setScope(id);
                  },
                },
                translate(SCOPE_TEXT[id].label),
              );
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsf-btn' + (caseSensitive ? ' dsf-btn-on' : ''),
              title: translate('matchCase'),
              'aria-label': translate('matchCase'),
              'aria-pressed': caseSensitive,
              onClick() {
                setCaseSensitive(function (value) {
                  return !value;
                });
              },
            },
            'Aa',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsf-btn' + (wholeWord ? ' dsf-btn-on' : ''),
              title: translate('wholeWord'),
              'aria-label': translate('wholeWord'),
              'aria-pressed': wholeWord,
              onClick() {
                setWholeWord(function (value) {
                  return !value;
                });
              },
            },
            h(
              'span',
              { style: { fontSize: '11px', letterSpacing: '-0.4px' } },
              '|ab|',
            ),
          ),
          h('span', { className: 'dsf-sep', 'aria-hidden': true }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsf-btn',
              title: translate('previous'),
              'aria-label': translate('previous'),
              disabled: total === 0,
              onClick() {
                if (moveRef.current) moveRef.current(-1);
              },
            },
            h(
              'svg',
              { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
              h('path', {
                d: 'M8 12 L8 4 M4.4 7.6 L8 4 L11.6 7.6',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.6,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsf-btn',
              title: translate('next'),
              'aria-label': translate('next'),
              disabled: total === 0,
              onClick() {
                if (moveRef.current) moveRef.current(1);
              },
            },
            h(
              'svg',
              { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
              h('path', {
                d: 'M8 4 L8 12 M4.4 8.4 L8 12 L11.6 8.4',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.6,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsf-btn',
              title: translate('close'),
              'aria-label': translate('close'),
              onClick() {
                setOpen(false);
              },
            },
            h(
              'svg',
              { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
              h('path', {
                d: 'M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.6,
                strokeLinecap: 'round',
              }),
            ),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        localeService = ctx.get('locale') || null;
        if (localeService) {
          const disposers = [];
          try {
            disposers.push(localeService.register(NS, 'en', EN));
            disposers.push(localeService.register(NS, 'zh', ZH));
            translate = localeService.bind(NS);
          } catch (error) {
            // A duplicate namespace (concurrent activation) must not disable the
            // bar: fall back to the bundled English strings instead.
            while (disposers.length) disposers.pop()();
          }
          if (disposers.length) {
            ctx.effect(function () {
              return function () {
                while (disposers.length) disposers.pop()();
              };
            });
          }
        }
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'session-find',
              order: 40,
              label: function () {
                return translate('title');
              },
            },
            FindBar,
          );
        });
      },
    };
  },
});
