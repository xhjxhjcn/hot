/* ============================================================
   行恒简安 · 今日热榜
   数据源：data/hot.json（GitHub Actions 每 30 分钟抓取各平台公开榜单）
   分类规则：data/taxonomy.json（前端筛选与构建期页脚索引共用同一份）
   ============================================================ */
(function () {
    'use strict';

    const DATA_PATH = 'data/hot.json';
    const CONFIG_PATH = 'data/config.json';
    const TAXONOMY_PATH = 'data/taxonomy.json';
    const THEME_KEY = 'hot_theme';
    const CAT_KEY = 'hot_cat';

    /* 卡片内固定展示的条数（必须与 scripts/prerender.js 的 CARD_ITEMS 一致）。
       原来 10 条 + 标题单行截断，长标题几乎全被切掉；现在标题给到两行，
       条数收到 8 条，卡片总高度基本持平而可读性明显更好。
       刻意不做卡内滚动 —— 触屏上下滑容易误点开链接，看全量走「查看全部」弹窗。 */
    const CARD_ITEMS = 8;

    /* 卡片展示顺序：微博第一、今日头条第二，其余按大众关注度递减。
       没列进来的源（以后新增的平台）排在最后，保持源站给的原始顺序。 */
    const SOURCE_ORDER = [
        'weibo', 'toutiao',
        'baidu', 'douyin', 'zhihu', 'thepaper',
        'qq-news', 'netease-news', 'sina-news', 'bilibili-hot', 'bilibili',
        'tieba', 'hupu', 'douban-movie',
        'ithome', '36kr', 'acfun',
        'csdn', 'juejin', 'sspai', 'v2ex', 'nodeseek',
        'guokr', 'yystv', 'ifanr', 'zhihu-daily', 'sina',
        'history', 'github', 'hellogithub', 'hackernews', 'nytimes',
    ];
    const ORDER_OF = new Map(SOURCE_ORDER.map((k, i) => [k, i]));
    const ORDER_TAIL = SOURCE_ORDER.length;

    /* 顶部平台快速导航（桌面端一行，移动端折叠面板给全部平台） */
    const SRC_QUICK = [
        'weibo', 'baidu', 'douyin', 'toutiao', 'zhihu', 'bilibili',
        'thepaper', 'tieba', 'qq-news', 'netease-news', 'ithome', '36kr',
    ];

    const BEIAN_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.75 3.9 5.2v6.4c0 4.9 3.4 9.6 8.1 10.8 4.7-1.2 8.1-5.9 8.1-10.8V5.2L12 1.75Zm-1.2 14.6-3.7-3.7 1.5-1.5 2.2 2.2 5.3-5.3 1.5 1.5-6.8 6.8Z"/></svg>';

    const $ = (sel) => document.querySelector(sel);

    const STATE = {
        data: null,
        sources: [],
        tax: null,
        cat: 'all',
        query: '',
    };

    /* ---------- 工具 ---------- */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtHot(n) {
        n = Number(n) || 0;
        if (n <= 0) return '';
        if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
        if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
        return String(n);
    }

    function relTime(iso) {
        const t = Date.parse(iso);
        if (!t) return '--';
        const diff = Math.round((Date.now() - t) / 1000);
        if (diff < 60) return '刚刚更新';
        if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前更新';
        if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前更新';
        return Math.floor(diff / 86400) + ' 天前更新';
    }

    function absTime(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '--';
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function hm(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function sortSources(list) {
        return list.slice().sort((a, b) => {
            const ra = ORDER_OF.has(a.key) ? ORDER_OF.get(a.key) : ORDER_TAIL;
            const rb = ORDER_OF.has(b.key) ? ORDER_OF.get(b.key) : ORDER_TAIL;
            return ra - rb;
        });
    }

    function byKey(key) {
        return STATE.sources.find((s) => s.key === key) || null;
    }

    /* 关键词转义后做高亮：先 esc 再替换，避免把 HTML 标签喂进 innerHTML */
    function escRe(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlight(text, q) {
        const safe = esc(text);
        if (!q) return safe;
        const re = new RegExp('(' + escRe(esc(q)) + ')', 'gi');
        return safe.replace(re, '<mark class="hl">$1</mark>');
    }

    function hit(it, q) {
        const needle = q.toLowerCase();
        return String(it.title || '').toLowerCase().indexOf(needle) >= 0
            || String(it.desc || '').toLowerCase().indexOf(needle) >= 0;
    }

    /* ---------- 分类 ---------- */
    function catsOf(key) {
        const map = (STATE.tax && STATE.tax.map) || {};
        return map[key] || [];
    }

    function inCat(key, cat) {
        if (cat === 'all') return true;
        return catsOf(key).indexOf(cat) >= 0;
    }

    function catCount(cat) {
        if (cat === 'all') return STATE.sources.length;
        return STATE.sources.filter((s) => inCat(s.key, cat)).length;
    }

    /* ---------- 数据 ---------- */
    async function loadData(bust) {
        const url = DATA_PATH + (bust ? '?t=' + Date.now() : '');
        const resp = await fetch(url, bust ? { cache: 'no-store' } : undefined);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const d = await resp.json();
        if (!d || !Array.isArray(d.sources)) throw new Error('数据格式异常');
        return d;
    }

    async function loadTaxonomy() {
        try {
            const r = await fetch(TAXONOMY_PATH, { cache: 'no-cache' });
            if (!r.ok) return null;
            const t = await r.json();
            if (!t || !Array.isArray(t.categories) || !t.map) return null;
            return t;
        } catch (e) {
            return null;
        }
    }

    /* ---------- 渲染：卡片 ---------- */
    function hotRowHTML(it, i, q) {
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const hot = fmtHot(it.hot);
        const desc = (it.desc || '').trim();
        const chip = desc && desc.length <= 6 ? `<span class="row-chip">${esc(desc)}</span>` : '';
        const title = it.title || '（标题缺失）';
        const href = it.url ? esc(it.url) : '';
        const tag = href ? 'a' : 'div';
        const attrs = (href ? ` href="${href}" target="_blank" rel="noopener noreferrer"` : '')
            + ` title="${esc(title)}"`;
        return `<${tag} class="hot-row"${attrs}>
            <span class="rank ${rankCls}">${i + 1}</span>
            <span class="row-main">
                <span class="row-title">${highlight(title, q)}${chip}</span>
            </span>
            ${hot ? `<span class="row-hot">${hot}</span>` : ''}
        </${tag}>`;
    }

    /* items 是「要渲染的条目」（可能是筛选后的），totalInSource 是源站全部条数 */
    function cardHTML(s, items, q, totalInSource) {
        const shown = items.slice(0, CARD_ITEMS);
        const upd = hm(STATE.data && STATE.data.updated);

        let body;
        if (!s.ok || !totalInSource) {
            body = `<div class="card-error"><strong>暂无数据</strong>${esc(s.error || '源站可能正在限流，稍后自动重试')}</div>`;
        } else if (!shown.length) {
            body = `<div class="card-error"><strong>没有匹配的条目</strong>换个关键词试试</div>`;
        } else {
            // items 里每项是 { it, i }：i 是它在原榜单里的位次，筛选后排名不重排，
            // 免得第 37 名搜出来变成「第 1 名」
            body = shown.map((e) => hotRowHTML(e.it, e.i, q)).join('');
        }

        const more = (s.ok && totalInSource > CARD_ITEMS)
            ? `<button type="button" class="expand" data-expand="${esc(s.key)}">查看全部 ${totalInSource} 条<span class="expand-arrow" aria-hidden="true">↗</span></button>`
            : '<span></span>';

        const countText = q
            ? `${items.length} 条相关`
            : `${totalInSource} 条`;

        return `<article class="hot-card${s.ok ? '' : ' is-off'}" id="card-${esc(s.key)}" data-key="${esc(s.key)}"
                 aria-labelledby="card-t-${esc(s.key)}">
            <header class="card-head">
                <img class="card-icon" src="${esc(s.icon)}" alt="" loading="lazy" width="20" height="20"
                     onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'card-icon',textContent:'📰'}))">
                <h2 class="card-title" id="card-t-${esc(s.key)}">${esc(s.label)}</h2>
                ${s.badge ? `<span class="card-badge">${esc(s.badge)}</span>` : ''}
                <span class="card-count${q ? ' is-match' : ''}">${countText}</span>
            </header>
            <div class="card-body">${body}</div>
            <footer class="card-foot">
                <span class="upd">${upd ? '更新 ' + upd : '--'}</span>
                ${more}
            </footer>
        </article>`;
    }

    function emptyHTML() {
        const q = STATE.query;
        if (!STATE.sources.length) {
            return `<div class="empty-state">
                <div class="empty-icon">⚠︎</div>
                <div class="empty-title">数据没有加载成功</div>
                <div class="empty-sub">可能是网络或接口临时异常，稍后重试即可。</div>
                <button type="button" class="btn-ghost-sm" data-retry="1">重新加载</button>
            </div>`;
        }
        const label = (STATE.tax
            ? (STATE.tax.categories.find((c) => c.key === STATE.cat) || {}).label
            : '') || '';
        return `<div class="empty-state">
            <div class="empty-icon">🔍</div>
            <div class="empty-title">${q ? `没有找到包含「${esc(q)}」的热点` : `「${esc(label)}」分类下暂无数据`}</div>
            <div class="empty-sub">${q ? '换个短一点的关键词，或清空筛选看看全部榜单。' : '可以切换到其它分类。'}</div>
            <button type="button" class="btn-ghost-sm" data-reset="1">查看全部榜单</button>
        </div>`;
    }

    /* ---------- 渲染：网格 ---------- */
    function renderGrid() {
        const grid = $('#hotGrid');
        const q = STATE.query;
        const list = sortSources(STATE.sources);

        let html = '';
        let matched = 0;
        let cards = 0;

        for (const s of list) {
            if (!inCat(s.key, STATE.cat)) continue;
            const all = (s.items || []).map((it, i) => ({ it, i }));
            let items = all;
            if (q) {
                items = all.filter((e) => hit(e.it, q));
                matched += items.length;
                if (!items.length) continue;
            }
            html += cardHTML(s, items, q, all.length);
            cards += 1;
        }

        grid.innerHTML = html || emptyHTML();

        const st = $('#filterStatus');
        if (q) {
            st.innerHTML = cards
                ? `在 <strong>${cards}</strong> 个平台找到 <strong>${matched.toLocaleString('zh-CN')}</strong> 条包含「<strong>${esc(q)}</strong>」的热点`
                : '';
            st.hidden = !cards;
        } else if (STATE.cat !== 'all') {
            const c = (STATE.tax ? STATE.tax.categories.find((x) => x.key === STATE.cat) : null) || {};
            st.innerHTML = `已筛选「<strong>${esc(c.label || '')}</strong>」分类，共 <strong>${cards}</strong> 个平台`;
            st.hidden = !cards;
        } else {
            st.hidden = true;
            st.innerHTML = '';
        }
    }

    /* ---------- 渲染：概览数字 ---------- */
    function renderStats() {
        if (!STATE.data) return;
        const ok = STATE.sources.filter((s) => s.ok).length;
        const items = STATE.sources.reduce((n, s) => n + (s.ok ? (s.items || []).length : 0), 0);

        const p = $('#statPlatforms');
        const it = $('#statItems');
        const up = $('#statUpdated');
        if (p) p.textContent = ok;
        if (it) it.textContent = items.toLocaleString('zh-CN');
        if (up) {
            up.textContent = absTime(STATE.data.updated);
            up.title = relTime(STATE.data.updated);
        }

        const dt = $('#dataTime');
        if (dt) dt.textContent = absTime(STATE.data.updated);

        const ageMin = (Date.now() - Date.parse(STATE.data.updated)) / 60000;
        const dot = $('#statusDot');
        if (dot) {
            dot.className = 'dot' + (ageMin > 240 ? ' stale' : '');
            dot.title = ageMin > 240 ? '数据可能已过期' : '数据正常';
        }
    }

    /* ---------- 渲染：筛选与平台导航 ---------- */
    function renderCatChips() {
        const box = $('#catChips');
        if (!box) return;
        if (!STATE.tax) { box.innerHTML = ''; return; }
        box.innerHTML = STATE.tax.categories.map((c) => {
            const on = c.key === STATE.cat ? ' aria-pressed="true"' : ' aria-pressed="false"';
            return `<button type="button" class="chip" data-cat="${esc(c.key)}"${on}>${esc(c.label)}<span class="chip-n">${catCount(c.key)}</span></button>`;
        }).join('');
    }

    function renderSrcChips() {
        const row = $('#srcChips');
        const panel = $('#srcPanel');
        const toggle = $('#srcToggle');
        if (!row || !panel) return;

        row.innerHTML = SRC_QUICK.filter((k) => byKey(k)).map((k) => {
            const s = byKey(k);
            return `<button type="button" class="chip chip-src" data-jump="${esc(k)}">${esc(s.label)}</button>`;
        }).join('');

        panel.innerHTML = sortSources(STATE.sources).map((s) =>
            `<button type="button" class="chip chip-src" data-jump="${esc(s.key)}">${esc(s.label)}<span class="chip-n">${(s.items || []).length}</span></button>`
        ).join('');

        if (toggle) toggle.hidden = !STATE.sources.length;
    }

    /* ---------- 渲染：页脚分组平台索引 ---------- */
    function footerGroupsHTML() {
        if (!STATE.tax || !STATE.sources.length) return '';
        const groups = STATE.tax.categories.filter((c) => c.key !== 'all');
        return groups.map((c) => {
            const list = sortSources(STATE.sources).filter((s) => inCat(s.key, c.key));
            if (!list.length) return '';
            const links = list.map((s) =>
                `<a href="/board/${esc(s.key)}" title="${esc(s.label)}${esc(s.badge || '热榜')}">${esc(s.label)}</a>`
            ).join('');
            return `<div class="fgroup">
                <h3 class="fgroup-title">${esc(c.label)}<span class="fgroup-n">${list.length}</span></h3>
                <div class="fgroup-links">${links}</div>
            </div>`;
        }).join('');
    }

    function renderFooter() {
        const box = $('#footerLinks');
        if (!box) return;
        const html = footerGroupsHTML();
        if (html) box.innerHTML = html;
    }

    function renderBoardNav() {
        const nav = $('#boardNav');
        if (!nav || nav.children.length || !STATE.sources.length) return;
        nav.innerHTML = sortSources(STATE.sources)
            .map((s) => `<a href="/board/${esc(s.key)}">${esc(s.label)}${esc(s.badge || '热榜')}</a>`)
            .join('');
        nav.hidden = false;
    }

    function renderAll() {
        renderStats();
        renderCatChips();
        renderSrcChips();
        renderGrid();
        renderFooter();
        renderBoardNav();
    }

    /* ---------- 交互 ---------- */
    function toast(msg, isErr) {
        const t = $('#toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.toggle('err', !!isErr);
        t.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => t.classList.remove('show'), 2600);
    }

    function setLoadbar(on) {
        const bar = $('#loadbar');
        if (bar) bar.hidden = !on;
        const grid = $('#hotGrid');
        if (grid) grid.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    /* 页头「刷新」：带 ?t= 重新拉一次 data/hot.json，绕过浏览器与边缘缓存。
       它不触发服务端重新抓取（静态站没有后端），抓取由 GitHub Actions 每 30 分钟跑。
       数据没变化时只提示、不重绘 —— 避免整页闪一下。 */
    let refreshing = false;

    async function refreshAll() {
        if (refreshing) return;
        refreshing = true;
        const btn = $('#refresh-all');
        const before = STATE.data && STATE.data.updated;
        btn.classList.add('loading');
        btn.disabled = true;
        setLoadbar(true);
        try {
            const d = await loadData(true);
            const changed = d.updated !== before;
            STATE.data = d;
            STATE.sources = d.sources;
            renderAll();
            if (changed) {
                toast('数据已更新到 ' + hm(d.updated));
            } else {
                toast('已是最新数据（' + hm(d.updated) + ' 抓取）');
            }
        } catch (e) {
            // 失败保留上一次有效数据，只提示
            toast('刷新失败，仍是上次数据：' + e.message, true);
            const dot = $('#statusDot');
            if (dot) dot.className = 'dot err';
        } finally {
            setLoadbar(false);
            setTimeout(() => {
                btn.classList.remove('loading');
                btn.disabled = false;
            }, 400);
            refreshing = false;
        }
    }

    /* ---------- 榜单详情弹窗 ---------- */
    const MODAL = { key: null, lastFocus: null };

    function modalRowHTML(it, i) {
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const hot = fmtHot(it.hot);
        const desc = (it.desc || '').trim();
        const chip = desc && desc.length <= 6 ? `<span class="row-chip">${esc(desc)}</span>` : '';
        const sub = desc && desc.length > 6 ? `<span class="m-row-sub">${esc(desc)}</span>` : '';
        const title = it.title || '（标题缺失）';
        const href = it.url ? esc(it.url) : '';
        const tag = href ? 'a' : 'div';
        const attrs = href ? ` href="${href}" target="_blank" rel="noopener noreferrer"` : '';
        return `<${tag} class="m-row"${attrs}>
            <span class="rank ${rankCls}">${i + 1}</span>
            <span class="m-row-main">
                <span class="m-row-title">${esc(title)}${chip}</span>
                ${sub}
            </span>
            ${hot ? `<span class="m-row-hot">${hot}</span>` : ''}
        </${tag}>`;
    }

    function modalTimeText() {
        if (!STATE.data || !STATE.data.updated) return '';
        return '榜单更新于 ' + relTime(STATE.data.updated).replace(/更新$/, '');
    }

    function fillModal(key) {
        const s = byKey(key);
        if (!s) return false;
        const items = s.items || [];

        const icon = $('#modalIcon');
        icon.src = s.icon || '';
        icon.alt = s.label;

        $('#modalTitle').textContent = s.label;

        const badge = $('#modalBadge');
        badge.textContent = s.badge || '';
        badge.hidden = !s.badge;

        $('#modalCount').textContent = s.ok && items.length
            ? `共 ${items.length} 条`
            : '暂无数据';

        $('#modalTime').textContent = modalTimeText();

        const link = $('#modalLink');
        link.href = s.link || '#';
        link.hidden = !s.link;

        $('#modalBody').innerHTML = (s.ok && items.length)
            ? items.map(modalRowHTML).join('')
            : `<div class="card-error"><strong>暂无数据</strong>${esc(s.error || '源站可能正在限流，稍后自动重试')}</div>`;

        $('#modalBody').scrollTop = 0;
        return true;
    }

    function lockScroll(on) {
        const body = document.body;
        if (on) {
            if (body.classList.contains('is-locked')) return;
            const gap = window.innerWidth - document.documentElement.clientWidth;
            document.documentElement.style.setProperty('--lock-gap', gap > 0 ? gap + 'px' : '0px');
            body.classList.add('is-locked');
        } else {
            body.classList.remove('is-locked');
        }
    }

    function trapFocus(e) {
        const panel = document.querySelector('.modal-panel');
        if (!panel) return;
        const nodes = Array.prototype.filter.call(
            panel.querySelectorAll('a[href], button:not([disabled])'),
            (el) => el.getClientRects().length > 0);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        const inside = panel.contains(active);
        if (e.shiftKey && (active === first || !inside)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
            e.preventDefault();
            first.focus();
        }
    }

    function openModal(key) {
        if (!fillModal(key)) return;
        MODAL.key = key;
        MODAL.lastFocus = document.activeElement;

        const ov = $('#modalOverlay');
        lockScroll(true);
        ov.classList.remove('is-open');
        void ov.offsetWidth;
        ov.classList.add('is-open');
        ov.setAttribute('aria-hidden', 'false');
        // 过渡起跑后再移入焦点：此时 visibility 还是 hidden，元素不可聚焦
        setTimeout(() => {
            if (!ov.contains(document.activeElement)) {
                $('#modalClose').focus({ preventScroll: true });
            }
        }, 80);
    }

    function closeModal() {
        const ov = $('#modalOverlay');
        if (!ov.classList.contains('is-open')) return;
        ov.classList.remove('is-open');
        ov.setAttribute('aria-hidden', 'true');
        lockScroll(false);

        const key = MODAL.key;
        const back = MODAL.lastFocus;
        MODAL.key = null;
        MODAL.lastFocus = null;

        let target = back && back.focus && back !== document.body ? back : null;
        if (!target && key) target = document.querySelector(`[data-expand="${key}"]`);
        if (target) target.focus({ preventScroll: true });
    }

    /* ---------- 平台跳转 ---------- */
    function jumpTo(key) {
        const reset = STATE.cat !== 'all' || STATE.query;
        if (reset) {
            STATE.cat = 'all';
            STATE.query = '';
            const input = $('#search-input');
            if (input) input.value = '';
            const clr = $('#searchClear');
            if (clr) clr.hidden = true;
            try { localStorage.setItem(CAT_KEY, 'all'); } catch (e) { /* ignore */ }
            renderAll();
        }
        const el = document.getElementById('card-' + key);
        if (!el) return;
        const headerH = $('#siteHeader') ? $('#siteHeader').offsetHeight : 60;
        const filtersH = $('#filters') ? $('#filters').offsetHeight : 0;
        const top = el.getBoundingClientRect().top + window.scrollY - headerH - filtersH - 12;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        el.classList.add('is-target');
        clearTimeout(jumpTo._t);
        jumpTo._t = setTimeout(() => el.classList.remove('is-target'), 1600);
    }

    /* ---------- 站内筛选 + 全网搜索 ---------- */
    /* 搜索框承担两件事：输入时即时筛选本页 32 个平台的条目（含高亮），
       回车交给搜索引擎搜全网。参数名各引擎不同（百度 wd、必应/谷歌 q），
       切换引擎时同时改 action 与 input.name，提交仍走浏览器原生行为。 */
    const ENGINES = {
        baidu: { action: 'https://www.baidu.com/s', param: 'wd' },
        bing: { action: 'https://www.bing.com/search', param: 'q' },
        google: { action: 'https://www.google.com/search', param: 'q' },
    };
    const ENGINE_KEY = 'hot_search_engine';

    function applyQueryFromInput() {
        const input = $('#search-input');
        const clr = $('#searchClear');
        if (!input) return;
        const v = input.value;
        if (clr) clr.hidden = !v;
        STATE.query = v.trim();
        renderGrid();
    }

    function initSiteSearch() {
        const form = $('#siteSearch');
        const sel = $('#search-engine');
        const input = $('#search-input');
        const clr = $('#searchClear');
        if (!form || !sel || !input) return;

        const applyEngine = () => {
            const e = ENGINES[sel.value] || ENGINES.baidu;
            form.action = e.action;
            input.name = e.param;
        };

        let saved = null;
        try { saved = localStorage.getItem(ENGINE_KEY); } catch (e) { /* ignore */ }
        if (saved && ENGINES[saved]) sel.value = saved;
        applyEngine();

        sel.addEventListener('change', () => {
            applyEngine();
            try { localStorage.setItem(ENGINE_KEY, sel.value); } catch (e) { /* ignore */ }
            input.focus();
        });

        let timer = null;
        input.addEventListener('input', () => {
            if (clr) clr.hidden = !input.value;
            clearTimeout(timer);
            timer = setTimeout(applyQueryFromInput, 130);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                input.value = '';
                applyQueryFromInput();
            }
        });

        if (clr) {
            clr.addEventListener('click', () => {
                input.value = '';
                applyQueryFromInput();
                input.focus();
            });
        }

        form.addEventListener('submit', (e) => {
            const q = input.value.trim();
            if (!q) {
                e.preventDefault();
                input.focus();
                return;
            }
            // 关键词里有内容时，表单照常提交给搜索引擎（新标签页打开）
        });
    }

    /* ---------- 事件绑定 ---------- */
    function wireEvents() {
        const btn = $('#refresh-all');
        if (btn) btn.addEventListener('click', refreshAll);

        const grid = $('#hotGrid');

        if (grid) {
            grid.addEventListener('click', (e) => {
                const ex = e.target.closest('[data-expand]');
                if (ex) { openModal(ex.dataset.expand); return; }
                const retry = e.target.closest('[data-retry]');
                if (retry) { setLoadbar(true); bootData().finally(() => setLoadbar(false)); return; }
                const reset = e.target.closest('[data-reset]');
                if (reset) resetFilters();
            });
        }

        const cats = $('#catChips');
        if (cats) {
            cats.addEventListener('click', (e) => {
                const b = e.target.closest('[data-cat]');
                if (!b) return;
                STATE.cat = b.dataset.cat;
                try { localStorage.setItem(CAT_KEY, STATE.cat); } catch (err) { /* ignore */ }
                renderCatChips();
                renderGrid();
            });
        }

        const jump = (e) => {
            const b = e.target.closest('[data-jump]');
            if (!b) return;
            const panel = $('#srcPanel');
            const toggle = $('#srcToggle');
            if (panel) panel.hidden = true;
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
            jumpTo(b.dataset.jump);
        };
        const srcRow = $('#srcChips');
        const srcPanel = $('#srcPanel');
        if (srcRow) srcRow.addEventListener('click', jump);
        if (srcPanel) srcPanel.addEventListener('click', jump);

        const toggle = $('#srcToggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const open = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
                const panel = $('#srcPanel');
                if (panel) panel.hidden = open;
            });
        }

        $('#modalClose').addEventListener('click', closeModal);
        $('#modalOverlay').addEventListener('click', (e) => {
            if (e.target === $('#modalOverlay')) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (!MODAL.key) return;
            if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
            if (e.key === 'Tab') trapFocus(e);
        });

        // 回到顶部
        const st = $('#scroll-top');
        window.addEventListener('scroll', () => {
            const y = window.scrollY || document.documentElement.scrollTop;
            st.classList.toggle('visible', y > 480);
            const hdr = $('#siteHeader');
            if (hdr) hdr.classList.toggle('is-scrolled', y > 8);
            const f = $('#filters');
            if (f) {
                const h = hdr ? hdr.offsetHeight : 60;
                f.classList.toggle('is-stuck', f.getBoundingClientRect().top <= h + 1);
            }
        }, { passive: true });
        st.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

        $('#dark-toggle').addEventListener('click', toggleTheme);
    }

    function resetFilters() {
        STATE.cat = 'all';
        STATE.query = '';
        const input = $('#search-input');
        if (input) input.value = '';
        const clr = $('#searchClear');
        if (clr) clr.hidden = true;
        try { localStorage.setItem(CAT_KEY, 'all'); } catch (e) { /* ignore */ }
        renderAll();
    }

    /* ---------- 主题 ---------- */
    function applyTheme(mode) {
        const dark = mode === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        const btn = $('#dark-toggle');
        if (btn) {
            btn.textContent = dark ? '☀️' : '🌙';
            btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', dark ? '#101114' : '#f7f7f5');
    }

    function toggleTheme() {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 隐私模式忽略 */ }
        applyTheme(next);
    }

    function initTheme() {
        let saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
        if (!saved) saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        applyTheme(saved);
    }

    /* ---------- 时钟 ---------- */
    function initDateTime() {
        const elHM = $('#clockHM'), elSec = $('#clockSec'), elYmd = $('#clockYmd'), elLunar = $('#clockLunar');
        if (!elHM) return;
        const pad = (n) => String(n).padStart(2, '0');
        const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        let lastDay = '';
        function update() {
            const now = new Date();
            elHM.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
            if (elSec) elSec.textContent = `:${pad(now.getSeconds())}`;
            const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
            if (key === lastDay) return;
            lastDay = key;
            if (elYmd) elYmd.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;
            if (elLunar) {
                let txt = '';
                try {
                    const L = window.LunarInfo && window.LunarInfo.info ? window.LunarInfo.info(now) : null;
                    if (L) txt = `${L.monthCn}月${L.dayCn}`;
                } catch (e) { txt = ''; }
                elLunar.textContent = txt;
            }
        }
        update();
        setInterval(update, 1000);
    }

    /* ---------- 备案信息 ---------- */
    async function loadConfig() {
        try {
            const r = await fetch(CONFIG_PATH, { cache: 'no-store' });
            if (!r.ok) return;
            const c = await r.json();
            const box = $('#footerBeian');
            if (!box) return;
            const parts = [];
            if (c.icp) {
                parts.push(`<a href="${esc(c.icpLink || 'https://beian.miit.gov.cn/')}" target="_blank" rel="noopener noreferrer">${BEIAN_ICON}${esc(c.icp)}</a>`);
            }
            if (c.psb) {
                parts.push(`<a href="${esc(c.psbLink || 'https://beian.mps.gov.cn/')}" target="_blank" rel="noopener noreferrer">${BEIAN_ICON}${esc(c.psb)}</a>`);
            }
            if (parts.length) {
                box.innerHTML = parts.join('<span class="beian-sep">|</span>');
                box.hidden = false;
            }
        } catch (e) { /* 无备案信息时静默 */ }
    }

    /* ---------- 启动 ---------- */
    async function bootData() {
        const grid = $('#hotGrid');
        // 首页在构建期已被 prerender 预渲染（静态卡片就在 DOM 里，供爬虫和首屏）。
        // 只有 grid 真的为空时才铺骨架屏，否则会把已有内容闪成骨架再画回来。
        if (grid && !grid.children.length) {
            grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
        }
        const d = await loadData(false);
        STATE.data = d;
        STATE.sources = d.sources;
        renderAll();
        return d;
    }

    async function boot() {
        initTheme();
        initDateTime();
        wireEvents();
        initSiteSearch();
        loadConfig();
        const y = $('#year');
        if (y) y.textContent = new Date().getFullYear();

        // 分类规则与数据并行拉取；分类拉不到就退化为「只有综合」，不出现假按钮
        const [tax] = await Promise.all([loadTaxonomy(), Promise.resolve()]);
        STATE.tax = tax;
        if (tax) {
            let savedCat = 'all';
            try { savedCat = localStorage.getItem(CAT_KEY) || 'all'; } catch (e) { /* ignore */ }
            if (tax.categories.some((c) => c.key === savedCat)) STATE.cat = savedCat;
        }

        // ?q=关键词：分享链接可带词直达（只做站内筛选，不自动跳转）
        const q0 = new URLSearchParams(location.search).get('q');
        if (q0) {
            const input = $('#search-input');
            if (input) input.value = q0;
            const clr = $('#searchClear');
            if (clr) clr.hidden = false;
            STATE.query = q0.trim();
        }

        try {
            await bootData();
            // 每分钟刷新相对时间
            setInterval(() => {
                if (!STATE.data) return;
                renderStats();
                document.querySelectorAll('.card-foot .upd').forEach((el) => {
                    const t = hm(STATE.data.updated);
                    if (t) el.textContent = '更新 ' + t;
                });
                const mt = $('#modalTime');
                if (mt && MODAL.key) mt.textContent = modalTimeText();
            }, 60000);
        } catch (e) {
            const grid = $('#hotGrid');
            if (grid && !grid.children.length) {
                grid.innerHTML = emptyHTML();
            } else {
                toast('数据加载失败，当前显示构建时的快照', true);
            }
            const dot = $('#statusDot');
            if (dot) dot.className = 'dot err';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
