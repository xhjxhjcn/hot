/* ============================================================
   行恒简安 · 今日热榜
   数据源：data/hot.json（由 GitHub Actions 定时从各平台官方接口抓取生成）
   ============================================================ */
(function () {
    'use strict';

    const DATA_PATH = 'data/hot.json';
    const CONFIG_PATH = 'data/config.json';
    const THEME_KEY = 'hot_theme';

    /* 各源所属分类，用于筛选。未列出的归入「榜单」。 */
    const CATEGORY = {
        'qq-news': 'news', 'sina-news': 'news', 'netease-news': 'news',
        'thepaper': 'news', 'sina': 'news', 'ithome': 'news', '36kr': 'news',
        'ifanr': 'news', 'zhihu-daily': 'news', 'history': 'news',
        'nytimes': 'news', 'guokr': 'news', 'yystv': 'news',
        'v2ex': 'community', 'nodeseek': 'community',
        'tieba': 'community', 'sspai': 'community', 'hupu': 'community',
    };

\1
    /* 公安联网备案：盾形+五角星，与 ICP 的盾形+对勾区分开 */
    const PSB_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M12 1.75 3.9 5.2v6.4c0 4.9 3.4 9.6 8.1 10.8 4.7-1.2 8.1-5.9 8.1-10.8V5.2L12 1.75Zm0 5.55L10.913 10.103 7.91 10.271 10.24 12.172 9.472 15.079 12 13.45 14.528 15.079 13.76 12.172 16.09 10.271 13.087 10.103 12 7.3Z"/></svg>';

    const $ = (sel) => document.querySelector(sel);

    let STATE = { data: null, sources: [], keyword: '', kind: 'all' };

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

    function catOf(key) { return CATEGORY[key] || 'rank'; }

    /* ---------- 数据 ---------- */
    async function loadData(bust) {
        const url = DATA_PATH + (bust ? '?t=' + Date.now() : '');
        const resp = await fetch(url, bust ? { cache: 'no-store' } : undefined);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const d = await resp.json();
        if (!d || !Array.isArray(d.sources)) throw new Error('数据格式异常');
        return d;
    }

    /* ---------- 渲染 ---------- */
    function sourceMatches(s, kw) {
        if (!kw) return true;
        if (s.label.toLowerCase().includes(kw) || s.key.includes(kw)) return true;
        if (s.badge && s.badge.toLowerCase().includes(kw)) return true;
        return (s.items || []).some((it) => (it.title || '').toLowerCase().includes(kw));
    }

    function visibleSources() {
        const kw = STATE.keyword.trim().toLowerCase();
        return STATE.sources.filter((s) => {
            if (STATE.kind !== 'all' && catOf(s.key) !== STATE.kind) return false;
            return sourceMatches(s, kw);
        });
    }

    function hotRowHTML(it, i) {
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const hot = fmtHot(it.hot);
        const desc = (it.desc || '').trim();
        // 短标签（沸 / 热 / 新 …）跟标题同行，长描述另起一行，避免行高参差
        const chip = desc && desc.length <= 6 ? `<span class="row-chip">${esc(desc)}</span>` : '';
        const sub = desc && desc.length > 6 ? `<span class="row-sub">${esc(desc)}</span>` : '';
        const href = it.url ? esc(it.url) : '';
        const tag = href ? 'a' : 'div';
        const attrs = href ? ` href="${href}" target="_blank" rel="noopener noreferrer"` : '';
        return `<${tag} class="hot-row"${attrs}>
            <span class="rank ${rankCls}">${i + 1}</span>
            <span class="row-main">
                <span class="row-title">${esc(it.title)}${chip}</span>
                ${sub}
            </span>
            ${hot ? `<span class="row-hot">${hot}</span>` : ''}
        </${tag}>`;
    }

    function cardHTML(s) {
        const kw = STATE.keyword.trim().toLowerCase();
        // 搜索时只展示命中的条目，避免无关内容干扰
        let items = s.items || [];
        if (kw && !s.label.toLowerCase().includes(kw) && !s.key.includes(kw)) {
            items = items.filter((it) => (it.title || '').toLowerCase().includes(kw));
        }
        const upd = STATE.data && STATE.data.updated ? STATE.data.updated : '';

        let body;
        if (!s.ok || !items.length) {
            body = `<div class="card-error"><strong>暂时没有抓到数据</strong>${esc(s.error || '源站可能正在限流')}</div>`;
        } else {
            body = items.map(hotRowHTML).join('');
        }

        // 卡片里只放滚动列表，看全量走弹窗（在本页弹出，不跳页也不撑高卡片）
        const more = (s.items || []).length > 12 && s.ok
            ? `<button type="button" class="expand" data-expand="${esc(s.key)}">查看全部 ${s.items.length} 条<span class="expand-arrow" aria-hidden="true">↗</span></button>`
            : '<span></span>';

        return `<article class="hot-card${s.ok ? '' : ' is-off'}" id="card-${esc(s.key)}" data-key="${esc(s.key)}">
            <header class="card-head">
                <img class="card-icon" src="${esc(s.icon)}" alt="" loading="lazy"
                     onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'card-icon',textContent:'📰'}))">
                <h2 class="card-title">${esc(s.label)}</h2>
                ${s.badge ? `<span class="card-badge">${esc(s.badge)}</span>` : ''}
                <button type="button" class="card-refresh" data-refresh="${esc(s.key)}" title="刷新该榜单" aria-label="刷新 ${esc(s.label)}">⟳</button>
            </header>
            <div class="card-body">${body}</div>
            <footer class="card-foot">
                <span class="upd">${upd ? esc(relTime(upd)) : '--'}</span>
                ${more}
            </footer>
        </article>`;
    }

    function renderGrid() {
        const grid = $('#hotGrid');
        const list = visibleSources();
        grid.innerHTML = list.map(cardHTML).join('');
        $('#emptyState').hidden = list.length > 0;
    }

    function renderOverview() {
        if (!STATE.data) return;
        const ok = STATE.sources.filter((s) => s.ok).length;
        const items = STATE.sources.reduce((n, s) => n + (s.ok ? s.items.length : 0), 0);
        $('#overviewSub').textContent =
            `已聚合 ${ok} 个平台 · ${items.toLocaleString('zh-CN')} 条热点，数据来自各平台官方公开接口`;
        $('#dataTime').textContent = absTime(STATE.data.updated);

        const ageMin = (Date.now() - Date.parse(STATE.data.updated)) / 60000;
        const dot = $('#statusDot');
        dot.className = 'dot' + (ageMin > 240 ? ' stale' : '');
        dot.title = ageMin > 240 ? '数据可能已过期' : '数据正常';
    }

    function renderFooterLinks() {
        $('#footerLinks').innerHTML = STATE.sources
            .map((s) => `<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`)
            .join('');
    }

    function render() {
        renderGrid();
        renderOverview();
    }

    /* ---------- 交互 ---------- */
    function toast(msg, isErr) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.toggle('err', !!isErr);
        t.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => t.classList.remove('show'), 2400);
    }

    async function refreshAll(silent) {
        const btn = $('#refresh-all');
        btn.classList.add('loading');
        try {
            const d = await loadData(true);
            STATE.data = d;
            STATE.sources = d.sources;
            render();
            renderFooterLinks();
            if (!silent) toast('数据已刷新 ✓');
        } catch (e) {
            if (!silent) toast('刷新失败：' + e.message, true);
            $('#statusDot').className = 'dot err';
        } finally {
            setTimeout(() => btn.classList.remove('loading'), 400);
        }
    }

    function jumpTo(key) {
        const el = $('#card-' + key);
        if (!el) { toast('该榜单当前被筛选隐藏了'); return; }
        const top = el.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top, behavior: 'smooth' });
        el.style.transition = 'box-shadow .3s ease, border-color .3s ease';
        el.style.boxShadow = '0 0 0 3px rgba(66,144,245,.45), 0 12px 40px rgba(66,144,245,.25)';
        setTimeout(() => { el.style.boxShadow = ''; }, 1600);
    }

    function setKind(kind) {
        STATE.kind = kind;
        document.querySelectorAll('.seg-item').forEach((b) =>
            b.classList.toggle('active', b.dataset.kind === kind));
        renderGrid();
    }

    /* ---------- 榜单详情弹窗 ---------- */
    /* 点卡片「查看全部」时在本页居中弹出，不跳页、也不再把卡片撑高。
       显隐靠 .is-open 类 + visibility/opacity 过渡；关闭时先摘类让过渡跑完。 */
    const MODAL = { key: null, lastFocus: null };

    function modalRowHTML(it, i) {
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const hot = fmtHot(it.hot);
        const desc = (it.desc || '').trim();
        const chip = desc && desc.length <= 6 ? `<span class="row-chip">${esc(desc)}</span>` : '';
        const sub = desc && desc.length > 6 ? `<span class="m-row-sub">${esc(desc)}</span>` : '';
        const href = it.url ? esc(it.url) : '';
        const tag = href ? 'a' : 'div';
        const attrs = href ? ` href="${href}" target="_blank" rel="noopener noreferrer"` : '';
        // --i 决定错峰入场的延迟档位，封顶 18 档，长列表不至于等太久
        return `<${tag} class="m-row" style="--i:${Math.min(i, 18)}"${attrs}>
            <span class="rank ${rankCls}">${i + 1}</span>
            <span class="m-row-main">
                <span class="m-row-title">${esc(it.title)}${chip}</span>
                ${sub}
            </span>
            ${hot ? `<span class="m-row-hot">${hot}</span>` : ''}
        </${tag}>`;
    }

    function modalTimeText() {
        if (!STATE.data || !STATE.data.updated) return '';
        // relTime 结尾自带「更新」，这里去掉，免得拼成「更新于…更新」
        return '榜单更新于 ' + relTime(STATE.data.updated).replace(/更新$/, '');
    }

    function fillModal(key) {
        const s = STATE.sources.find((x) => x.key === key);
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
            : '暂时没有抓到数据';

        $('#modalTime').textContent = modalTimeText();

        const link = $('#modalLink');
        link.href = s.link || '#';
        link.hidden = !s.link;

        $('#modalBody').innerHTML = (s.ok && items.length)
            ? items.map(modalRowHTML).join('')
            : `<div class="card-error"><strong>暂时没有抓到数据</strong>${esc(s.error || '源站可能正在限流')}</div>`;

        $('#modalBody').scrollTop = 0;
        return true;
    }

    function lockScroll(on) {
        const body = document.body;
        if (on) {
            if (body.classList.contains('is-locked')) return;
            // 锁滚动会收起页面滚动条，补上等宽内边距，避免内容横向跳一下
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
        void ov.offsetWidth;                 // 强制回流，保证动画能重播
        ov.classList.add('is-open');
        ov.setAttribute('aria-hidden', 'false');
        // 注意：不能在这一帧就 focus()。此时过渡进度还是 0，visibility 的计算值仍是
        // hidden（visibility 是离散插值），元素不可聚焦，focus 会被静默忽略。
        // 等过渡起跑后再移入焦点。
        setTimeout(() => {
            if (!ov.contains(document.activeElement)) {
                $('#modalClose').focus({ preventScroll: true });
            }
        }, 90);
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

        // 焦点交还：优先回到触发元素；若当时没有可聚焦元素（脚本触发点击时
        // activeElement 是 body），就退回该卡片的「查看全部」按钮
        let target = back && back.focus && back !== document.body ? back : null;
        if (!target && key) target = document.querySelector(`[data-expand="${key}"]`);
        if (target) target.focus({ preventScroll: true });
    }

    function wireEvents() {
        // 搜索
        const input = $('#search-input');
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                STATE.keyword = input.value;
                $('#search-clear').hidden = !input.value;
                renderGrid();
            }, 160);
        });
        $('#search-clear').addEventListener('click', () => {
            input.value = '';
            STATE.keyword = '';
            $('#search-clear').hidden = true;
            renderGrid();
            input.focus();
        });

        // 分类
        document.querySelectorAll('.seg-item').forEach((b) =>
            b.addEventListener('click', () => setKind(b.dataset.kind)));

        // 页眉快速定位
        document.querySelectorAll('[data-jump]').forEach((b) =>
            b.addEventListener('click', () => jumpTo(b.dataset.jump)));

        // 刷新
        $('#refresh-all').addEventListener('click', () => refreshAll(false));

        // 卡片内交互（事件委托）
        $('#hotGrid').addEventListener('click', (e) => {
            const ex = e.target.closest('[data-expand]');
            if (ex) {
                openModal(ex.dataset.expand);
                return;
            }
            const rf = e.target.closest('[data-refresh]');
            if (rf) {
                rf.classList.add('spin');
                refreshAll(true).then(() => {
                    toast('「' + (STATE.sources.find((s) => s.key === rf.dataset.refresh) || {}).label + '」已刷新 ✓');
                    if (MODAL.key === rf.dataset.refresh) fillModal(MODAL.key);
                }).finally(() => setTimeout(() => rf.classList.remove('spin'), 300));
            }
        });

        // 弹窗：关闭按钮 / 点遮罩 / Esc
        $('#modalClose').addEventListener('click', closeModal);
        $('#modalOverlay').addEventListener('click', (e) => {
            if (e.target === $('#modalOverlay')) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (!MODAL.key) return;
            if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
            if (e.key === 'Tab') trapFocus(e);
        });

        // 弹窗内刷新当前榜单
        $('#modalRefresh').addEventListener('click', async () => {
            const btn = $('#modalRefresh');
            if (btn.classList.contains('busy')) return;
            btn.classList.add('busy');
            const key = MODAL.key;
            try {
                await refreshAll(true);
                if (MODAL.key === key) fillModal(key);
                toast('已刷新 ✓');
            } catch (err) {
                toast('刷新失败：' + err.message, true);
            } finally {
                setTimeout(() => btn.classList.remove('busy'), 300);
            }
        });

        // 回到顶部
        const st = $('#scroll-top');
        window.addEventListener('scroll', () => {
            st.classList.toggle('visible', (window.scrollY || document.documentElement.scrollTop) > 400);
        }, { passive: true });
        st.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

        // 主题
        $('#dark-toggle').addEventListener('click', toggleTheme);
    }

    /* ---------- 主题 ---------- */
    function applyTheme(mode) {
        document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
        $('#dark-toggle').textContent = mode === 'dark' ? '☀️' : '🌙';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', mode === 'dark' ? '#0d1524' : '#eaf1fb');
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
        const pad = (n) => String(n).padStart(2, '0');
        const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        let lastDay = '';
        function update() {
            const now = new Date();
            if (elHM) elHM.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
            if (elSec) elSec.textContent = `:${pad(now.getSeconds())}`;
            const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
            if (key === lastDay) return;
            lastDay = key;
            if (elYmd) elYmd.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${WEEK[now.getDay()]}`;
            if (elLunar) {
                let txt = '';
                try {
                    const L = window.LunarInfo && window.LunarInfo.info ? window.LunarInfo.info(now) : null;
                    if (L) txt = `农历${L.monthCn}月${L.dayCn} · ${L.ganZhi}${L.shengXiao}年`;
                } catch (e) { txt = ''; }
                elLunar.textContent = txt;
            }
        }
        update();
        setInterval(update, 1000);
    }

    /* ---------- 背景网格 ---------- */
    function initTechCanvas() {
        const canvas = $('#tech-canvas');
        if (!canvas || !canvas.getContext) return;
        let ctx = null;
        try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
        if (!ctx) return;

        let width, height;
        const spacing = 48;
        let dots = [];
        function resize() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }
        function buildDots() {
            dots = [];
            for (let x = 0; x < width; x += spacing) {
                for (let y = 0; y < height; y += spacing) {
                    dots.push({ x, y, phase: Math.random() * Math.PI * 2 });
                }
            }
        }
        resize(); buildDots();
        window.addEventListener('resize', () => { resize(); buildDots(); });

        let rafId;
        function draw(time) {
            const dark = document.documentElement.getAttribute('data-theme') === 'dark';
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = dark ? 'rgba(90, 160, 255, 0.22)' : 'rgba(66, 144, 245, 0.15)';
            ctx.strokeStyle = dark ? 'rgba(90, 160, 255, 0.08)' : 'rgba(66, 144, 245, 0.06)';
            ctx.lineWidth = 1;
            for (let i = 0; i < dots.length; i++) {
                const d = dots[i];
                const pulse = 0.5 + 0.5 * Math.sin(time * 0.002 + d.phase);
                ctx.beginPath();
                ctx.arc(d.x, d.y, 1 + pulse * 1.2, 0, Math.PI * 2);
                ctx.fill();
                const right = dots[i + 1];
                if (right && Math.abs(right.y - d.y) < 1) {
                    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(right.x, right.y); ctx.stroke();
                }
                const below = dots[i + Math.ceil(height / spacing)];
                if (below && Math.abs(below.x - d.x) < 1) {
                    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(below.x, below.y); ctx.stroke();
                }
            }
            rafId = requestAnimationFrame(draw);
        }
        draw(0);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) cancelAnimationFrame(rafId);
            else rafId = requestAnimationFrame(draw);
        });
    }

    /* ---------- 备案信息 ---------- */
    async function loadConfig() {
        try {
            const r = await fetch(CONFIG_PATH, { cache: 'no-store' });
            if (!r.ok) return;
            const c = await r.json();
            const box = $('#footerBeian');
            const parts = [];
            if (c.icp) {
                parts.push(`<a href="${esc(c.icpLink || 'https://beian.miit.gov.cn/')}" target="_blank" rel="noopener noreferrer">${BEIAN_ICON}${esc(c.icp)}</a>`);
            }
            if (c.psb) {
                parts.push(`<a href="${esc(c.psbLink || 'https://beian.mps.gov.cn/')}" target="_blank" rel="noopener noreferrer">${PSB_ICON}${esc(c.psb)}</a>`);
            }
            if (parts.length) {
                box.innerHTML = parts.join('<span class="beian-sep">|</span>');
                box.hidden = false;
            }
        } catch (e) { /* 无备案信息时静默 */ }
    }

    /* ---------- 启动 ---------- */
    async function boot() {
        initTheme();
        initTechCanvas();
        initDateTime();
        wireEvents();
        loadConfig();
        $('#year').textContent = new Date().getFullYear();

        const grid = $('#hotGrid');
        grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');

        try {
            STATE.data = await loadData(false);
            STATE.sources = STATE.data.sources;
            render();
            renderFooterLinks();
            // 每分钟刷新相对时间
            setInterval(() => {
                document.querySelectorAll('.card-foot .upd').forEach((el) => {
                    el.textContent = relTime(STATE.data.updated);
                });
                const mt = $('#modalTime');
                if (mt && MODAL.key) mt.textContent = modalTimeText();
                renderOverview();
            }, 60000);
        } catch (e) {
            grid.innerHTML = `<div class="card-error" style="grid-column:1/-1;padding:60px 20px">
                <strong>数据加载失败</strong>${esc(e.message)}<br>
                <button type="button" class="btn-ghost-sm" style="margin-top:14px" onclick="location.reload()">重新加载</button>
            </div>`;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
