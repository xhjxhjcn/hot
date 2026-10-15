#!/usr/bin/env node
'use strict';
/**
 * 预渲染（prerender）—— 让搜索引擎不执行 JS 也能读到全部榜单内容。
 *
 * 背景：index.html 原本是个空壳，32 个榜单全靠 assets/app.js 拉 data/hot.json
 * 后注入，爬虫拿到的正文只有 176 个字符（「正在加载各平台榜单…」）。这直接
 * 导致 Bing 上只有一个可索引 URL、关键词覆盖接近零。
 *
 * 本脚本从 data/hot.json 生成整套静态页面：
 *   dist/index.html              首页（榜单卡片预渲染进 #hotGrid）
 *   dist/boards.html             全部榜单导航（热榜大全 / 热榜导航）→ 对外地址 /boards
 *   dist/all-hot.html            全网热搜总榜（跨平台按热度合并排序）→ /all-hot
 *   dist/guide.html              使用指南 + FAQ（覆盖使用意图词）→ /guide
 *   dist/board/<key>.html   ×N   单平台榜单页（微博热搜榜 / 抖音热榜 …）
 *   dist/topic/<slug>.html  ×N   领域聚合页（科技热榜 / 程序员热榜 …）
 *   dist/today/<日期>.html  ×N   每日归档（日期类长尾词）
 *   dist/today/index.html        归档索引
 *   dist/sitemap.xml             sitemap
 *   dist/<INDEXNOW_KEY>.txt      IndexNow 校验文件
 *
 * 零依赖，只用 Node 内置模块。构建期由 build-dist.js 调用。
 *
 * ⚠ 首页里的卡片标记必须与 assets/app.js 的 cardHTML() 保持一致：预渲染的
 * DOM 是给爬虫看的，同时用户首屏也会看到它，随后 app.js 拉完数据会原地
 * 重渲染一遍 —— 结构一致才不会跳版。
 */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ */
/* 站点常量                                                            */
/* ------------------------------------------------------------------ */

const SITE = 'https://hot.xhja.cn';
/* ⚠ 对外地址一律不带 .html。
   阿里云 ESA 的 Pages 开了「自动去除 .html」：访问 /boards.html 会 307 跳到
   /boards，而 /boards 直接 200。所以 canonical / sitemap / 站内链接 / JSON-LD
   里的 URL 全部用不带后缀的形式，否则每个链接都白吃一跳、sitemap 还会塞满
   重定向地址。dist/ 里的文件仍按 .html 落盘 —— 旧索引过的 .html 地址靠平台
   自身的 307 照样能进。
   目录型页面保留结尾斜杠：/today 会 307 到 /today/。
   如果哪天托管方关掉这个特性，这里要整体改回带 .html 的形式。 */
const BRAND = '行恒简安';
const PORTAL = 'https://www.xhja.cn';
const SITE_NAME = '今日热榜';
const SLOGAN = '汇聚全网热点 · 热门尽览无余';
const OG_IMAGE = SITE + '/assets/logo.png';

// IndexNow 密钥（8~128 位，只允许 a-z A-Z 0-9 -）。对应产物 dist/<key>.txt
const INDEXNOW_KEY = 'a7f3c9e21b84d65038c1f7a9e4b2d608';

// 首页卡片内固定展示条数，必须与 app.js 的 CARD_ITEMS 一致
const CARD_ITEMS = 10;
// 归档快照每个源保留条数
const ARCHIVE_PER_SOURCE = 20;
// sitemap 里最多列入多少天归档
const ARCHIVE_IN_SITEMAP = 30;

/* 与 app.js 的 SOURCE_ORDER 保持一致：预渲染顺序 = 前端渲染顺序 */
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

/* ------------------------------------------------------------------ */
/* 关键词矩阵：每个平台页的 TDK                                        */
/* h1       —— 页面 H1，也是主攻词                                      */
/* aliases  —— 同义/近义词条，进 keywords meta 与正文                    */
/* desc     —— 页面独有描述（≥60 字），进 description 与正文             */
/* ------------------------------------------------------------------ */

const SOURCE_SEO = {
    weibo: {
        h1: '微博热搜榜', aliases: ['微博热搜', '微博热搜实时榜', '微博热门话题榜', '今日微博热搜'],
        desc: '微博热搜榜实时更新，聚合微博实时热搜与热门话题 Top 50。明星八卦、社会热点、突发事件一屏看全，每 30 分钟自动同步一次。',
    },
    baidu: {
        h1: '百度热搜榜', aliases: ['百度热搜', '百度热搜榜实时', '百度热点排行', '今日百度热搜'],
        desc: '百度热搜榜实时更新，聚合百度实时热点热搜 Top 50，覆盖时政要闻、社会民生、娱乐体育、财经科技等全网热门话题。',
    },
    douyin: {
        h1: '抖音热榜', aliases: ['抖音热点', '抖音热搜榜', '抖音热点榜', '今日抖音热点'],
        desc: '抖音热榜实时更新，聚合抖音站内热点榜 Top 50，短视频热门话题、挑战赛、网红事件与全民关注热点一眼看尽。',
    },
    toutiao: {
        h1: '今日头条热榜', aliases: ['头条热榜', '今日头条热点', '头条热搜', '今日头条热搜榜'],
        desc: '今日头条热榜实时更新，聚合头条站内热榜 Top 50，时政、财经、社会、娱乐、科技等头条热门资讯按热度排序。',
    },
    zhihu: {
        h1: '知乎热榜', aliases: ['知乎热榜实时', '知乎热门问题', '知乎热搜榜', '今日知乎热榜'],
        desc: '知乎热榜实时更新，聚合知乎站内热门问题 Top 30。同一条热点下的高赞回答与专业讨论，一次看清舆论走向。',
    },
    bilibili: {
        h1: 'B站热门排行榜', aliases: ['哔哩哔哩排行榜', 'bilibili排行榜', 'B站热门视频', 'B站全站排行榜'],
        desc: 'B站热门排行榜实时更新，聚合哔哩哔哩全站排行榜 Top 50，热门视频、UP 主爆款与二次元热点集中呈现。',
    },
    'bilibili-hot': {
        h1: 'B站热搜榜', aliases: ['哔哩哔哩热搜', 'bilibili热搜', 'B站热搜实时', '今日B站热搜'],
        desc: 'B站热搜榜实时更新，聚合哔哩哔哩站内搜索热词 Top 30，反映 B 站用户当下最关心的热点事件与话题。',
    },
    'qq-news': {
        h1: '腾讯新闻热点榜', aliases: ['腾讯新闻热榜', '腾讯热搜榜', '腾讯新闻热搜'],
        desc: '腾讯新闻热点榜实时更新，聚合腾讯新闻热点榜 Top 50，国内外重大事件、社会民生与财经要闻按热度呈现。',
    },
    'sina-news': {
        h1: '新浪新闻热点榜', aliases: ['新浪热榜', '新浪新闻热搜', '新浪热点排行'],
        desc: '新浪新闻热点榜实时更新，聚合新浪新闻热点榜 Top 30，综合报道重要时事与社会关切话题。',
    },
    'netease-news': {
        h1: '网易新闻热点榜', aliases: ['网易热榜', '网易新闻热搜', '网易热点排行'],
        desc: '网易新闻热点榜实时更新，聚合网易新闻热点榜 Top 50，聚焦社会热点、财经动态与深度报道。',
    },
    thepaper: {
        h1: '澎湃新闻热榜', aliases: ['澎湃新闻热点', '澎湃热搜榜', '澎湃热榜实时'],
        desc: '澎湃新闻热榜实时更新，聚合澎湃新闻热点榜 Top 30，时政、法治、财经与社会调查类深度报道一览。',
    },
    tieba: {
        h1: '百度贴吧热议榜', aliases: ['贴吧热议', '百度贴吧热榜', '贴吧热搜'],
        desc: '百度贴吧热议榜实时更新，聚合贴吧全站热议话题 Top 30，各兴趣吧的讨论焦点与网络新梗来源。',
    },
    ithome: {
        h1: 'IT之家热榜', aliases: ['IT之家热搜', 'IT之家热门文章', '科技热榜IT之家'],
        desc: 'IT之家热榜实时更新，聚合 IT 之家站内热门文章 Top 50，数码新品、科技资讯与行业动态一网打尽。',
    },
    csdn: {
        h1: 'CSDN 热榜', aliases: ['CSDN热搜', 'CSDN热门博客', '程序员热榜CSDN'],
        desc: 'CSDN 热榜实时更新，聚合 CSDN 站内热门技术文章 Top 30，覆盖后端、前端、AI、运维等技术方向的当红选题。',
    },
    juejin: {
        h1: '掘金热榜', aliases: ['掘金热门文章', '掘金热搜', '前端热榜'],
        desc: '掘金热榜实时更新，聚合掘金社区热门技术文章 Top 50，涵盖前端、后端、AI、工程化等开发者关注方向。',
    },
    '36kr': {
        h1: '36氪热榜', aliases: ['36氪热门文章', '36kr热榜', '创投热榜'],
        desc: '36氪热榜实时更新，聚合 36 氪站内热门文章 Top 50，聚焦创投动向、新经济公司与科技商业趋势。',
    },
    hupu: {
        h1: '虎扑步行街热榜', aliases: ['虎扑热榜', '虎扑步行街', '虎扑亮了', '虎扑体育热点'],
        desc: '虎扑步行街热榜实时更新，聚合虎扑「亮了」热门帖 Top 50，体育赛事、球迷热议与步行街神回复集中呈现。',
    },
    'douban-movie': {
        h1: '豆瓣电影热门榜', aliases: ['豆瓣电影热门', '豆瓣热门电影', '豆瓣电影排行榜'],
        desc: '豆瓣电影热门榜实时更新，聚合豆瓣电影热门条目 Top 30，正在热映、口碑新片与高分影视作品一览。',
    },
    acfun: {
        h1: 'AcFun 排行榜', aliases: ['A站排行榜', 'acfun排行榜', 'A站热门视频'],
        desc: 'AcFun 排行榜实时更新，聚合 A 站全站排行榜 Top 30，二次元、鬼畜、生活区热门视频与 UP 主作品。',
    },
    'zhihu-daily': {
        h1: '知乎日报今日推荐', aliases: ['知乎日报', '知乎日报热门', '知乎日报今日文章'],
        desc: '知乎日报今日推荐，精选知乎站内当日值得一读的深度内容，适合每天花几分钟读完的优质长文。',
    },
    sina: {
        h1: '新浪热点榜', aliases: ['新浪网热点', '新浪热点新闻', '新浪热点排行'],
        desc: '新浪热点榜实时更新，聚合新浪网点热点 Top 30，综合门户视角下的当日重要新闻与热门事件。',
    },
    sspai: {
        h1: '少数派热门文章', aliases: ['少数派热榜', 'sspai热门', '效率工具热榜'],
        desc: '少数派热门文章实时更新，聚合少数派站内热门 Top 24，效率工具、数字生活与生产力方法精选。',
    },
    github: {
        h1: 'GitHub Trending 趋势榜', aliases: ['GitHub热门项目', 'GitHub趋势', 'github trending 今日', '开源项目热榜'],
        desc: 'GitHub Trending 趋势榜实时更新，聚合 GitHub 当日趋势项目，按语言分类的开源热门仓库、新项目与爆款工具。',
    },
    hellogithub: {
        h1: 'HelloGitHub 精选', aliases: ['HelloGitHub', '开源项目精选', 'HelloGitHub 月刊'],
        desc: 'HelloGitHub 精选实时更新，精选有趣、入门级开源项目，适合开发者发现值得关注与动手实践的开源作品。',
    },
    hackernews: {
        h1: 'Hacker News 热榜', aliases: ['HN热榜', '黑客新闻热榜', '国外技术热榜'],
        desc: 'Hacker News 热榜实时更新，聚合 HN 首页 Top 30，全球工程师社区正在讨论的技术、创业与产品话题。',
    },
    guokr: {
        h1: '果壳热门文章', aliases: ['果壳网热门', '果壳热榜', '科学热榜'],
        desc: '果壳热门文章实时更新，聚合果壳网热门科普 Top 9，用有趣的视角拆解科学、自然与生活常识。',
    },
    yystv: {
        h1: '游研社热门文章', aliases: ['游戏热榜', '游研社热榜', '游戏新闻热点'],
        desc: '游研社热门文章实时更新，聚合游研社站内热文，主机、PC 与独立游戏圈的热点话题、评测与行业观察。',
    },
    ifanr: {
        h1: '爱范儿热文', aliases: ['爱范儿热门', '爱范儿热榜', '数码热榜'],
        desc: '爱范儿热文实时更新，聚合爱范儿站内热门文章，消费电子新品、数码评测与科技生活方式观察。',
    },
    history: {
        h1: '历史上的今天', aliases: ['今天历史上的今天', '历史上的今天大事记', '历史上的今天事件'],
        desc: '历史上的今天每日更新，按日期列出当天发生的重大历史事件，帮助快速了解「历史上的今天」发生了什么。',
    },
    v2ex: {
        h1: 'V2EX 热议榜', aliases: ['V2EX热帖', 'v2ex热门', '程序员社区热榜'],
        desc: 'V2EX 热议榜实时更新，聚合 V2EX 站内热门主题，程序员社区正在讨论的技术、职场与生活话题。',
    },
    nodeseek: {
        h1: 'NodeSeek 今日热帖', aliases: ['NodeSeek热榜', 'NodeSeek热帖', 'NS论坛热榜'],
        desc: 'NodeSeek 今日热帖实时更新，聚合 NodeSeek 社区当日热门讨论，VPS、主机与数码爱好者关注焦点。',
    },
    nytimes: {
        h1: '纽约时报中文热榜', aliases: ['纽约时报头条', 'NYT热榜', '国际新闻热榜'],
        desc: '纽约时报中文热榜实时更新，聚合纽约时报首页要闻，国际时事、深度报道与全球视角下的重要议题。',
    },
};

/* ------------------------------------------------------------------ */
/* 领域聚合页：一个页面对应一组平台，吃「XX 热榜」这类品类词            */
/* ------------------------------------------------------------------ */

const TOPICS = [
    {
        slug: 'tech', h1: '科技热榜', keys: ['ithome', '36kr', 'ifanr', 'sspai', 'guokr'],
        aliases: ['科技热榜', '数码科技热点', '科技新闻热榜', '互联网科技热点'],
        desc: '科技热榜聚合 IT 之家、36 氪、爱范儿、少数派、果壳等科技媒体的当日热门内容，覆盖数码新品、互联网动态、创业投资与科学科普，一页看完科技圈在关心什么。',
    },
    {
        slug: 'dev', h1: '程序员热榜', keys: ['github', 'hellogithub', 'hackernews', 'v2ex', 'nodeseek', 'csdn', 'juejin'],
        aliases: ['程序员热榜', '技术热榜', '开发者热榜', '开源热榜'],
        desc: '程序员热榜聚合 GitHub Trending、HelloGitHub、Hacker News、V2EX、NodeSeek、CSDN 与掘金等开发者社区的热门内容，覆盖开源项目趋势、技术文章与工程师讨论，是了解技术圈风向的快捷入口。',
    },
    {
        slug: 'news', h1: '新闻热点榜', keys: ['toutiao', 'qq-news', 'netease-news', 'sina-news', 'thepaper', 'sina', 'nytimes'],
        aliases: ['新闻热点榜', '时事热点', '今日新闻热点', '新闻热榜排行'],
        desc: '新闻热点榜聚合今日头条、腾讯新闻、网易新闻、新浪新闻、澎湃新闻与纽约时报等门户的当日热点，按热度排序呈现国内外重大新闻，快速掌握时事动态。',
    },
    {
        slug: 'ent', h1: '娱乐热搜榜', keys: ['weibo', 'douyin', 'bilibili-hot', 'bilibili', 'douban-movie', 'acfun'],
        aliases: ['娱乐热搜榜', '娱乐热点', '明星热搜', '娱乐圈热点'],
        desc: '娱乐热搜榜聚合微博、抖音、B 站、豆瓣电影等平台的娱乐类热门内容，明星动态、影视热映、综艺热点与网友讨论一站看全。',
    },
    {
        slug: 'society', h1: '社会热点榜', keys: ['baidu', 'weibo', 'toutiao', 'douyin', 'tieba'],
        aliases: ['社会热点榜', '社会热点事件', '民生热点', '网络热点事件'],
        desc: '社会热点榜聚合百度、微博、今日头条、抖音与贴吧的社会民生类热点，突发公共事件、民生话题与全民讨论焦点按热度汇总。',
    },
    {
        slug: 'game', h1: '游戏热榜', keys: ['yystv', 'acfun', 'bilibili', 'hupu', 'bilibili-hot'],
        aliases: ['游戏热榜', '游戏新闻热点', '主机游戏热点', '游戏圈热点'],
        desc: '游戏热榜聚合游研社、AcFun、B 站与虎扑的游戏类热门内容，主机与 PC 新作、独立游戏、电竞与玩家社区话题集中呈现。',
    },
    {
        slug: 'sports', h1: '体育热点榜', keys: ['hupu', 'weibo', 'douyin', 'tieba', 'toutiao'],
        aliases: ['体育热点榜', '体育热榜', '体育新闻热点', '赛事热点'],
        desc: '体育热点榜聚合虎扑、微博、抖音与贴吧的体育类热点，涵盖足球、篮球、电竞等赛事的战报、转会与球迷热议。',
    },
    {
        slug: 'movie', h1: '影视热榜', keys: ['douban-movie', 'bilibili', 'zhihu', 'weibo', 'thepaper'],
        aliases: ['影视热榜', '热门电影榜', '影视热点', '剧集热度榜'],
        desc: '影视热榜聚合豆瓣电影、B 站、知乎与微博的影视类热门内容，正在热映的电影、剧集口碑与观众讨论一目了然。',
    },
    {
        slug: 'digi', h1: '数码热榜', keys: ['ifanr', 'ithome', 'sspai', '36kr'],
        aliases: ['数码热榜', '数码热点', '消费电子热点', '手机新品热点'],
        desc: '数码热榜聚合爱范儿、IT 之家、少数派与 36 氪的数码类热门内容，手机、平板、笔记本等消费电子产品的新品、评测与讨论。',
    },
    {
        slug: 'community', h1: '社区热帖榜', keys: ['tieba', 'hupu', 'v2ex', 'nodeseek', 'zhihu'],
        aliases: ['社区热帖榜', '论坛热帖', '网络社区热点', '热帖排行'],
        desc: '社区热帖榜聚合百度贴吧、虎扑、V2EX、NodeSeek 与知乎的社区热门帖，各圈层网友正在讨论的话题与高赞观点汇总。',
    },
];

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

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

function absTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '--';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cnDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '--';
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
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

function orderOf(key) {
    const i = SOURCE_ORDER.indexOf(key);
    return i < 0 ? SOURCE_ORDER.length : i;
}

function sortSources(list) {
    return list.slice().sort((a, b) => orderOf(a.key) - orderOf(b.key));
}

/* 平台页的展示名：优先 SOURCE_SEO.h1，否则 label+badge */
function boardName(s) {
    const seo = SOURCE_SEO[s.key];
    return seo ? seo.h1 : `${s.label}${s.badge || '热榜'}`;
}

function boardAliases(s) {
    const seo = SOURCE_SEO[s.key];
    return seo ? seo.aliases : [`${s.label}热榜`, `${s.label}热搜`];
}

function boardDesc(s) {
    const seo = SOURCE_SEO[s.key];
    return seo ? seo.desc
        : `${boardName(s)}实时更新，聚合${s.label}${s.badge || '榜单'}最新内容，与全网其他平台热榜一屏对照。`;
}

/* ------------------------------------------------------------------ */
/* 首页卡片标记（必须与 assets/app.js 的 cardHTML/hotRowHTML 结构一致） */
/* ------------------------------------------------------------------ */

function hotRowHTML(it, i) {
    const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
    const hot = fmtHot(it.hot);
    const desc = (it.desc || '').trim();
    const chip = desc && desc.length <= 6 ? `<span class="row-chip">${esc(desc)}</span>` : '';
    const href = it.url ? esc(it.url) : '';
    const tag = href ? 'a' : 'div';
    const attrs = (href ? ` href="${href}" target="_blank" rel="noopener noreferrer"` : '')
        + ` title="${esc(it.title)}"`;
    return `<${tag} class="hot-row"${attrs}>
            <span class="rank ${rankCls}">${i + 1}</span>
            <span class="row-main">
                <span class="row-title">${esc(it.title)}${chip}</span>
            </span>
            ${hot ? `<span class="row-hot">${hot}</span>` : ''}
        </${tag}>`;
}

function cardHTML(s, updated) {
    const items = s.items || [];
    const shown = items.slice(0, CARD_ITEMS);

    let body;
    if (!s.ok || !shown.length) {
        body = `<div class="card-error"><strong>暂时没有抓到数据</strong>${esc(s.error || '源站可能正在限流')}</div>`;
    } else {
        body = shown.map(hotRowHTML).join('');
    }

    const more = items.length > CARD_ITEMS && s.ok
        ? `<button type="button" class="expand" data-expand="${esc(s.key)}">查看全部 ${items.length} 条<span class="expand-arrow" aria-hidden="true">↗</span></button>`
        : '<span></span>';

    return `<article class="hot-card${s.ok ? '' : ' is-off'}" id="card-${esc(s.key)}" data-key="${esc(s.key)}">
            <header class="card-head">
                <img class="card-icon" src="${esc(s.icon)}" alt="" loading="lazy"
                     onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'card-icon',textContent:'📰'}))">
                <h2 class="card-title">${esc(s.label)}</h2>
                ${s.badge ? `<span class="card-badge">${esc(s.badge)}</span>` : ''}
            </header>
            <div class="card-body">${body}</div>
            <footer class="card-foot">
                <span class="upd">${updated ? esc(relTime(updated)) : '--'}</span>
                ${more}
            </footer>
        </article>`;
}

/* ------------------------------------------------------------------ */
/* 子页外壳                                                            */
/* ------------------------------------------------------------------ */

const BEIAN_LINK_ICP = 'https://beian.miit.gov.cn/';
const BEIAN_LINK_PSB = 'https://beian.mps.gov.cn/#/query/webSearch?code=33082502000463';
const BEIAN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.75 3.9 5.2v6.4c0 4.9 3.4 9.6 8.1 10.8 4.7-1.2 8.1-5.9 8.1-10.8V5.2L12 1.75Zm-1.2 14.6-3.7-3.7 1.5-1.5 2.2 2.2 5.3-5.3 1.5 1.5-6.8 6.8Z"/></svg>';

function beianHTML(cfg) {
    const parts = [];
    if (cfg && cfg.icp) {
        parts.push(`<a href="${esc(cfg.icpLink || BEIAN_LINK_ICP)}" target="_blank" rel="noopener noreferrer">${BEIAN_SVG}${esc(cfg.icp)}</a>`);
    }
    if (cfg && cfg.psb) {
        parts.push(`<a href="${esc(cfg.psbLink || BEIAN_LINK_PSB)}" target="_blank" rel="noopener noreferrer">${BEIAN_SVG}${esc(cfg.psb)}</a>`);
    }
    return parts.join('<span class="beian-sep">|</span>');
}

/* 全站榜单导航：首页与子页共用，同时是内链枢纽 */
function boardNavHTML(sources, currentKey) {
    const links = sources.map((s) => {
        const cls = s.key === currentKey ? ' class="is-current"' : '';
        return `<a href="/board/${esc(s.key)}"${cls}>${esc(boardName(s))}</a>`;
    }).join('');
    return links;
}

function shell(opts) {
    const {
        title, desc, keywords, canonical, h1, crumbs, intro,
        body, related, ld, cfg, sources, currentKey, lastmod,
    } = opts;

    const crumbHTML = [
        '<a href="/">首页</a>',
        ...crumbs.map((c, i) => {
            const sep = '<span class="sep">›</span>';
            const last = i === crumbs.length - 1;
            const node = c.href && !last ? `<a href="${esc(c.href)}">${esc(c.text)}</a>` : `<span>${esc(c.text)}</span>`;
            return sep + node;
        }),
    ].join('');

    const ldTags = (Array.isArray(ld) ? ld : [ld])
        .filter(Boolean)
        .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
        .join('\n    ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}">
    <meta name="keywords" content="${esc(keywords)}">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
    <meta name="author" content="${esc(BRAND)}">
    <link rel="canonical" href="${esc(canonical)}">
    <meta name="theme-color" content="#eaf1fb">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${esc(BRAND)} · ${esc(SITE_NAME)}">
    <meta property="og:locale" content="zh_CN">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:url" content="${esc(canonical)}">
    <meta property="og:image" content="${esc(OG_IMAGE)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(desc)}">
    <meta name="twitter:image" content="${esc(OG_IMAGE)}">
    <link rel="icon" href="/assets/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="/assets/favicon-32.png" sizes="32x32">
    <link rel="icon" type="image/png" href="/assets/favicon-192.png" sizes="192x192">
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
    <link rel="stylesheet" href="/assets/style.css">
    ${ldTags}
</head>
<body class="subpage">
    <header class="site-header">
        <div class="header-inner">
            <a class="brand" href="/" aria-label="${esc(BRAND)} 今日热榜首页">
                <img src="/assets/logo.png" alt="${esc(BRAND)}" class="brand-logo">
                <div class="brand-text">
                    <span class="brand-name">${esc(SITE_NAME)}</span>
                    <span class="brand-slogan">${esc(SLOGAN)}</span>
                </div>
            </a>
            <div class="header-actions sub-nav">
                <a class="sub-nav-link" href="/boards">全部榜单</a>
                <a class="sub-nav-link" href="/all-hot">全网热搜总榜</a>
                <a class="sub-nav-link" href="/guide">使用指南</a>
            </div>
        </div>
    </header>

    <main class="page-wrap">
        <nav class="crumbs" aria-label="面包屑">${crumbHTML}</nav>

        <div class="board-hero">
            <h1>${esc(h1)}</h1>
            <div class="hero-meta">${lastmod ? `<span>更新于 ${esc(lastmod)}</span>` : ''}</div>
            ${intro ? `<p class="hero-intro">${intro}</p>` : ''}
        </div>

        ${body}

        ${related ? `<section class="rel-block"><h2 class="rel-title">相关榜单</h2>${related}</section>` : ''}

        <section class="board-nav-block">
            <h2 class="rel-title">全部榜单导航</h2>
            <div class="board-nav">${boardNavHTML(sources, currentKey)}</div>
        </section>
    </main>

    <footer class="site-footer">
        <div class="footer-inner">
            <div class="footer-brand">
                <img src="/assets/logo.png" alt="" class="footer-logo">
                <div>
                    <div class="footer-name">${esc(BRAND)}</div>
                    <div class="footer-slogan">行恒致远 · 简安自得</div>
                </div>
            </div>
            <div class="footer-beian">${beianHTML(cfg)}</div>
            <div class="xhja-mail"><a href="mailto:x@xhja.cn">📧 联系我：x@xhja.cn</a></div>
            <div class="footer-copy">© <span>${new Date().getFullYear()}</span> ${esc(BRAND)}</div>
        </div>
    </footer>

    <script>
    (function () {
        try {
            var k = 'hot_theme', s = localStorage.getItem(k);
            if (s !== 'dark' && s !== 'light') {
                s = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            document.documentElement.setAttribute('data-theme', s);
        } catch (e) { /* 隐私模式忽略 */ }
    })();
    </script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* 各页面生成器                                                        */
/* ------------------------------------------------------------------ */

/* 1. 首页：把预渲染内容填进源 index.html 的锚点 */
function renderIndex(template, data, sources, cfg) {
    const updated = data.updated;
    const ok = sources.filter((s) => s.ok).length;
    const items = sources.reduce((n, s) => n + (s.ok ? (s.items || []).length : 0), 0);

    // 头部只留一行摘要，别把卡片挤到屏幕外
    const overviewSub = `已聚合 ${ok} 个平台 · ${items.toLocaleString('zh-CN')} 条热点 · 每 30 分钟自动更新`;

    const grid = sources.map((s) => cardHTML(s, updated)).join('\n            ');

    const footerLinks = sources
        .map((s) => `<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`)
        .join('');

    // 逐处替换模板锚点。rel 直接改写外层 html 变量，不做链式赋值 ——
    // 链式赋值时每次都会拿着「原始模板」再替换一遍，前面的改动会被覆盖掉。
    // 替换值走函数形式，避免内容里的 $& / $1 被当成反向引用。
    let html = template;
    const rel = (find, repl) => {
        if (!html.includes(find)) {
            throw new Error(`index.html 模板缺少锚点，预渲染失败：${find.slice(0, 70)}`);
        }
        html = html.replace(find, () => repl);
    };

    rel('<p id="overviewSub">正在加载各平台榜单…</p>',
        `<p id="overviewSub">${esc(overviewSub)}</p>`);
    rel('<span id="dataTime">--</span>', `<span id="dataTime">${esc(absTime(updated))}</span>`);
    rel('<div class="hot-grid" id="hotGrid"></div>',
        `<div class="hot-grid" id="hotGrid">\n            ${grid}\n            </div>`);
    rel('<div class="footer-links" id="footerLinks"></div>',
        `<div class="footer-links" id="footerLinks">${footerLinks}</div>`);
    rel('<div class="footer-beian" id="footerBeian" hidden></div>',
        `<div class="footer-beian" id="footerBeian">${beianHTML(cfg)}</div>`);
    rel('<nav class="board-nav" id="boardNav" hidden aria-label="全部榜单导航"></nav>',
        `<nav class="board-nav" id="boardNav" aria-label="全部榜单导航">${boardNavHTML(sources, null)}</nav>`);
    rel('<!--PRERENDER:ITEMLIST-->',
        `<script type="application/ld+json">${JSON.stringify(indexItemListLD(sources))}</script>`);

    // 年份用正则换，避免跨年时写死锚点失效
    const yearRe = /<span id="year">\d{4}<\/span>/;
    if (!yearRe.test(html)) throw new Error('index.html 模板缺少 #year 锚点，预渲染失败');
    html = html.replace(yearRe, () => `<span id="year">${new Date().getFullYear()}</span>`);

    return html;
}

function indexItemListLD(sources) {
    return {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        '@id': SITE + '/#boards',
        name: SITE_NAME + ' · 全部热榜榜单',
        description: '今日热榜聚合的全部平台榜单导航，共 ' + sources.length + ' 个平台热榜。',
        url: SITE + '/',
        isPartOf: { '@id': SITE + '/#website' },
        mainEntity: {
            '@type': 'ItemList',
            name: '全部热榜榜单',
            numberOfItems: sources.length,
            itemListElement: sources.map((s, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: boardName(s),
                url: `${SITE}/board/${s.key}`,
            })),
        },
    };
}

/* 榜单条目的摘要处理，规则与 app.js 一致：
   ≤6 字的是「热 / 新 / 沸」这类角标，跟着标题走；更长的才当摘要正文。 */
function itemDescParts(it) {
    const d = (it.desc || '').trim();
    if (!d) return { chip: '', sub: '' };
    return d.length <= 6
        ? { chip: `<span class="b-chip">${esc(d)}</span>`, sub: '' }
        : { chip: '', sub: `<span class="b-desc">${esc(d)}</span>` };
}

/* 单平台榜单页 */
function renderBoard(s, sources, cfg, updated) {
    const name = boardName(s);
    const aliases = boardAliases(s);
    const items = (s.items || []);

    const title = `${name} - 实时更新 | ${aliases.slice(0, 2).join('·')} - ${SITE_NAME}`;
    const keywords = [name, ...aliases, SITE_NAME, '全网热榜', '热搜榜', '实时热搜', BRAND].join(',');
    const desc = boardDesc(s);

    const listHTML = items.length
        ? `<ol class="b-list">${items.map((it, i) => {
            const rankCls = i === 0 ? ' r1' : i === 1 ? ' r2' : i === 2 ? ' r3' : '';
            const hot = fmtHot(it.hot);
            const { chip, sub } = itemDescParts(it);
            const inner = `<span class="b-rank${rankCls}">${i + 1}</span>
                <span class="b-main">
                    <span class="b-title">${esc(it.title)}${chip}</span>
                    ${sub}
                </span>
                ${hot ? `<span class="b-hot">${hot}</span>` : ''}`;
            return it.url
                ? `<li class="b-item"><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
                : `<li class="b-item"><div>${inner}</div></li>`;
        }).join('')}</ol>`
        : `<div class="b-empty">该榜单暂时没有抓到数据，源站可能正在限流，稍后会自动恢复。</div>`;

    const watch = sources.filter((x) => x.key !== s.key).slice(0, 8);
    const related = `<div class="rel-grid">${[
        ...TOPICS.filter((t) => t.keys.includes(s.key)).map((t) => `<a class="rel-link" href="/topic/${t.slug}">${esc(t.h1)}</a>`),
        ...watch.map((x) => `<a class="rel-link" href="/board/${x.key}">${esc(boardName(x))}</a>`),
        '<a class="rel-link" href="/all-hot">全网热搜总榜</a>',
        '<a class="rel-link" href="/boards">全部榜单</a>',
    ].join('')}</div>`;

    const noteHTML = `<section class="board-note">
        <h2 class="rel-title">关于${esc(name)}</h2>
        <ul class="note-list">
            <li><strong>榜单来源</strong>：${esc(s.label)}${esc(s.badge || '榜单')}（<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">原站入口</a>）</li>
            <li><strong>更新频率</strong>：每 30 分钟自动抓取一次，本页快照取自 ${esc(absTime(updated))}</li>
            <li><strong>同义搜索</strong>：${aliases.map(esc).join('、')}</li>
            <li><strong>当前收录</strong>：${items.length} 条，按原站热度排序</li>
            <li><strong>本站范围</strong>：共聚合 ${sources.length} 个平台公开榜单，见<a href="/boards">全部热榜榜单导航</a></li>
        </ul>
    </section>`;

    const intro = `${esc(name)}（${aliases.map(esc).join('、')}）实时更新，与${esc(s.label)}官方${esc(s.badge || '榜单')}同步，当前共 ${items.length} 条，数据每 30 分钟自动抓取一次。`
        + ` ${esc(desc)}`
        + ` 本站同时聚合 ${sources.length} 个平台的热榜内容，可在页面底部切换到其他平台；数据只做聚合展示，条目点击后跳转至原站。`;

    return shell({
        title,
        desc: `${name}（${aliases.slice(0, 3).join('、')}）实时更新，当前收录 ${items.length} 条。${desc}`.slice(0, 210),
        keywords,
        canonical: `${SITE}/board/${s.key}`,
        h1: name,
        crumbs: [{ text: '全部榜单', href: '/boards' }, { text: name }],
        intro,
        body: listHTML + noteHTML,
        related,
        lastmod: absTime(updated),
        ld: [
            {
                '@context': 'https://schema.org',
                '@type': 'ItemList',
                '@id': `${SITE}/board/${s.key}#list`,
                name,
                description: desc,
                url: `${SITE}/board/${s.key}`,
                numberOfItems: items.length,
                itemListOrder: 'https://schema.org/ItemListOrderDescending',
                itemListElement: items.slice(0, 30).map((it, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    name: it.title,
                    url: it.url || undefined,
                })),
            },
            {
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
                    { '@type': 'ListItem', position: 2, name: '全部榜单', item: SITE + '/boards' },
                    { '@type': 'ListItem', position: 3, name, item: `${SITE}/board/${s.key}` },
                ],
            },
        ],
        cfg, sources, currentKey: s.key,
    });
}

/* 3. 领域聚合页 */
function renderTopic(t, sources, cfg, updated) {
    const picked = sources.filter((s) => t.keys.includes(s.key) && s.ok);
    const all = [];
    for (const s of picked) {
        for (const it of (s.items || []).slice(0, 20)) {
            all.push({ ...it, from: s.label, fromKey: s.key });
        }
    }

    const perSource = picked.map((s) => {
        const items = (s.items || []).slice(0, 12);
        if (!items.length) return '';
        return `<section class="topic-src">
            <h3 class="topic-src-title"><a href="/board/${s.key}">${esc(boardName(s))}</a></h3>
            <ol class="b-list b-list-slim">${items.map((it, i) => {
                const rankCls = i < 3 ? ` r${i + 1}` : '';
                const hot = fmtHot(it.hot);
                const inner = `<span class="b-rank${rankCls}">${i + 1}</span>
                    <span class="b-main"><span class="b-title">${esc(it.title)}</span></span>
                    ${hot ? `<span class="b-hot">${hot}</span>` : ''}`;
                return it.url
                    ? `<li class="b-item"><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
                    : `<li class="b-item"><div>${inner}</div></li>`;
            }).join('')}</ol>
        </section>`;
    }).join('');

    const title = `${t.h1} - ${t.aliases.slice(0, 2).join('·')} - ${SITE_NAME}`;
    const keywords = [t.h1, ...t.aliases, SITE_NAME, '全网热榜', '热搜榜', BRAND].join(',');

    const related = `<div class="rel-grid">${[
        ...picked.map((s) => `<a class="rel-link" href="/board/${s.key}">${esc(boardName(s))}</a>`),
        ...TOPICS.filter((x) => x.slug !== t.slug).map((x) => `<a class="rel-link" href="/topic/${x.slug}">${esc(x.h1)}</a>`),
    ].join('')}</div>`;

    return shell({
        title,
        desc: `${t.h1}实时更新，聚合 ${picked.map((s) => s.label).join('、')} 等 ${picked.length} 个平台的${t.aliases[0]}内容，共 ${all.length} 条热点。${t.desc}`.slice(0, 210),
        keywords,
        canonical: `${SITE}/topic/${t.slug}`,
        h1: t.h1,
        crumbs: [{ text: '全部榜单', href: '/boards' }, { text: t.h1 }],
        intro: `${esc(t.desc)} 当前聚合 ${picked.length} 个平台、${all.length} 条热点，数据每 30 分钟自动更新。`,
        body: `<div class="topic-wrap">${perSource}</div>`,
        related,
        lastmod: absTime(updated),
        ld: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            '@id': `${SITE}/topic/${t.slug}`,
            name: t.h1,
            description: t.desc,
            url: `${SITE}/topic/${t.slug}`,
            isPartOf: { '@id': SITE + '/#website' },
            mainEntity: {
                '@type': 'ItemList',
                name: t.h1,
                numberOfItems: picked.length,
                itemListElement: picked.map((s, i) => ({
                    '@type': 'ListItem', position: i + 1,
                    name: boardName(s), url: `${SITE}/board/${s.key}`,
                })),
            },
        },
        cfg, sources, currentKey: null,
    });
}

/* 4. 全网热搜总榜：跨平台按热度合并 */
function renderAllHot(sources, cfg, updated) {
    const seen = new Set();
    const merged = [];
    for (const s of sources) {
        if (!s.ok) continue;
        for (const it of (s.items || [])) {
            const t = (it.title || '').trim();
            if (!t || seen.has(t)) continue;
            seen.add(t);
            merged.push({ ...it, from: s.label, hot: Number(it.hot) || 0 });
        }
    }
    merged.sort((a, b) => b.hot - a.hot);
    const top = merged.slice(0, 100);

    const listHTML = `<ol class="b-list">${top.map((it, i) => {
        const rankCls = i === 0 ? ' r1' : i === 1 ? ' r2' : i === 2 ? ' r3' : '';
        const hot = fmtHot(it.hot);
        const inner = `<span class="b-rank${rankCls}">${i + 1}</span>
            <span class="b-main">
                <span class="b-title">${esc(it.title)}</span>
                <span class="b-from">来自 ${esc(it.from)}</span>
            </span>
            ${hot ? `<span class="b-hot">${hot}</span>` : ''}`;
        return it.url
            ? `<li class="b-item"><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
            : `<li class="b-item"><div>${inner}</div></li>`;
    }).join('')}</ol>`;

    const h1 = '全网热搜总榜';
    const title = `全网热搜榜 - 实时热搜排行 | ${SITE_NAME}`;
    const desc = `全网热搜榜按热度合并 ${sources.length} 个平台的实时热搜，跨平台去重排序生成的全网热点排行榜，实时反映当下最受关注的网络热点事件。`;

    return shell({
        title,
        desc,
        keywords: ['全网热搜榜', '全网热榜', '实时热搜', '热搜排行', '热点排行榜', '热搜榜实时', '全网热点', SITE_NAME, BRAND].join(','),
        canonical: `${SITE}/all-hot`,
        h1,
        crumbs: [{ text: '全部榜单', href: '/boards' }, { text: h1 }],
        intro: `全网热搜榜把微博、百度、抖音、知乎、今日头条等 ${sources.length} 个平台的热搜条目按热度统一合并排序，去掉跨平台重复内容，得到同一时刻的全网热搜排行。当前共收录 ${merged.length} 条，展示热度最高的 100 条。`,
        body: listHTML,
        related: `<div class="rel-grid"><a class="rel-link" href="/boards">全部榜单</a><a class="rel-link" href="/topic/society">社会热点榜</a><a class="rel-link" href="/topic/ent">娱乐热搜榜</a><a class="rel-link" href="/topic/news">新闻热点榜</a><a class="rel-link" href="/guide">使用指南</a></div>`,
        lastmod: absTime(updated),
        ld: {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: h1,
            description: desc,
            url: `${SITE}/all-hot`,
            numberOfItems: top.length,
            itemListOrder: 'https://schema.org/ItemListOrderDescending',
            itemListElement: top.slice(0, 50).map((it, i) => ({
                '@type': 'ListItem', position: i + 1, name: it.title,
                url: it.url || undefined,
            })),
        },
        cfg, sources, currentKey: null,
    });
}

/* 5. 全部榜单导航页 */
function renderBoards(sources, cfg, updated) {
    const groups = [
        { title: '综合热搜榜', keys: ['weibo', 'baidu', 'douyin', 'toutiao', 'zhihu', 'tieba'] },
        { title: '新闻资讯榜', keys: ['qq-news', 'netease-news', 'sina-news', 'thepaper', 'sina', 'nytimes'] },
        { title: '视频与榜单', keys: ['bilibili', 'bilibili-hot', 'acfun', 'douban-movie'] },
        { title: '科技与开发', keys: ['ithome', '36kr', 'ifanr', 'sspai', 'csdn', 'juejin', 'github', 'hellogithub', 'hackernews', 'v2ex', 'nodeseek'] },
        { title: '社区与兴趣', keys: ['hupu', 'yystv', 'guokr', 'zhihu-daily', 'history'] },
    ];
    const byKey = new Map(sources.map((s) => [s.key, s]));

    const body = groups.map((g) => {
        const cards = g.keys.map((k) => {
            const s = byKey.get(k);
            if (!s) return '';
            const n = (s.items || []).length;
            const top3 = (s.items || []).slice(0, 3).map((it) => esc(it.title)).join(' · ');
            return `<a class="board-card" href="/board/${esc(s.key)}">
                <span class="board-card-head">
                    <img src="/${esc(s.icon)}" alt="" loading="lazy" width="28" height="28">
                    <span class="board-card-name">${esc(boardName(s))}</span>
                    <span class="board-card-count">${n} 条</span>
                </span>
                <span class="board-card-top">${top3}</span>
            </a>`;
        }).join('');
        return `<section class="board-group"><h2 class="group-title">${esc(g.title)}</h2><div class="board-cards">${cards}</div></section>`;
    }).join('');

    const topicHTML = `<section class="board-group"><h2 class="group-title">按领域看热榜</h2><div class="rel-grid">${
        TOPICS.map((t) => `<a class="rel-link" href="/topic/${t.slug}">${esc(t.h1)}</a>`).join('')
    }</div></section>`;

    const h1 = '全部热榜榜单导航';
    const desc = `今日热榜全部榜单导航：一站式直达微博热搜榜、百度热搜榜、抖音热榜、知乎热榜、B 站热门、今日头条、腾讯新闻、澎湃新闻、IT 之家、GitHub Trending 等 ${sources.length} 个平台的实时热榜，并按科技、新闻、娱乐、游戏等十大领域归类。`;

    return shell({
        title: `全部热榜榜单导航 - 热搜榜大全 | ${SITE_NAME}`,
        desc,
        keywords: ['热榜导航', '热搜导航', '热榜大全', '全部热榜', '各平台热搜榜', '全网热榜', '热搜榜大全', SITE_NAME, BRAND].join(','),
        canonical: `${SITE}/boards`,
        h1,
        crumbs: [{ text: h1 }],
        intro: `这里收录本站聚合的全部 ${sources.length} 个平台热榜入口，按综合热搜、新闻资讯、视频榜单、科技开发、社区兴趣五类归组。点击任意条目进入对应平台的热榜页面，实时查看该平台的最新排名。`,
        body: body + topicHTML,
        related: `<div class="rel-grid"><a class="rel-link" href="/all-hot">全网热搜总榜</a><a class="rel-link" href="/guide">使用指南</a></div>`,
        lastmod: absTime(updated),
        ld: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: h1, description: desc, url: `${SITE}/boards`,
            mainEntity: {
                '@type': 'ItemList',
                numberOfItems: sources.length,
                itemListElement: sources.map((s, i) => ({
                    '@type': 'ListItem', position: i + 1,
                    name: boardName(s), url: `${SITE}/board/${s.key}`,
                })),
            },
        },
        cfg, sources, currentKey: null,
    });
}

/* 6. 使用指南 + FAQ */
function renderGuide(sources, cfg, updated) {
    const h1 = '今日热榜使用指南';
    const desc = '今日热榜怎么用？这份指南说明如何用热榜找自媒体选题、追热点、做舆情监测、跟技术趋势，并附常见问题解答。';
    const faq = [
        ['今日热榜是什么？', `今日热榜是${BRAND}旗下的实时热点聚合站，聚合微博、百度、抖音、知乎、B 站、今日头条、IT 之家、GitHub 等 ${sources.length} 个平台的公开榜单，按平台分类展示，一屏纵览全网热点。`],
        ['数据多久更新一次？', '数据由 GitHub Actions 定时任务每 30 分钟自动抓取一次，每次抓取各平台官方公开接口，不做人工干预。页面右上角显示最近一次更新时间。'],
        ['可以在手机上使用吗？', '可以。页面做了响应式适配，手机、平板、电脑都能正常浏览，并支持深色模式，跟随系统主题自动切换。'],
        ['怎么快速找到某个平台的热榜？', '三种方式：一是用页面顶部的搜索框直接搜平台名或关键词；二是用「全部」/「榜单」/「资讯」/「社区」分类标签筛选；三是直接访问「全部热榜榜单导航」页面进入单平台页面。'],
        ['热榜可以用来做什么？', '常见用途有：自媒体与公众号找选题、运营人员追热点、品牌做舆情监测、程序员跟技术趋势、普通用户快速了解今天发生了什么。'],
        ['网站数据来自哪里？', '全部来自各平台的官方公开接口或公开页面，本站只做聚合与展示，不修改任何内容，条目点击后跳转至原平台。'],
    ];

    const body = `
        <section class="guide-body">
            <h2>一、快速上手</h2>
            <p>打开首页就能看到全部 ${sources.length} 个平台的榜单卡片，每张卡片默认展示前 10 条。点卡片底部的「查看全部」可以在当前页弹出完整榜单，不用跳转。右上角的「刷新」按钮会重新拉取最新数据；搜索框支持按平台名或关键词过滤，输入「游戏」会筛出所有包含该关键词的条目。</p>

            <h2>二、自媒体与公众号找选题</h2>
            <p>找选题的核心是「同一个话题在不同平台的热度差」。本站把各平台榜单并排放置，一眼就能看出某条内容是不是跨平台发酵：只在微博火、没上抖音，说明还在早期，适合抢先做；如果微博、抖音、百度、知乎同时出现，通常已经进入爆发期，这时候要拼角度而不是拼速度。建议每天固定看两次 —— 早间看隔夜积累，晚间看当天峰值。</p>

            <h2>三、运营与品牌追热点</h2>
            <p>追热点最怕「追晚了」和「追错方向」。用「社会热点榜」「娱乐热搜榜」这类领域聚合页可以快速判断热点所属的圈层；用「全网热搜总榜」可以看跨平台合并后的真实热度排名，避免被单一平台的情绪放大误导。判断一个热点能否蹭，先看它在榜单上停留了多久 —— 停留越久说明讨论深度越足，越适合做长内容。</p>

            <h2>四、舆情监测</h2>
            <p>对品牌方来说，榜单的价值在于「早发现」。建议每天定时检查与自己行业相关的平台页，比如消费品盯微博与抖音，科技产品盯 IT 之家与少数派，游戏产品盯 B 站与游研社。发现异常条目时，直接点进原平台查看上下文，本站不存储任何用户数据，所有判断都应回到原平台。</p>

            <h2>五、程序员跟技术趋势</h2>
            <p>「程序员热榜」把 GitHub Trending、HelloGitHub、Hacker News、V2EX、NodeSeek、CSDN 与掘金放在一起，既能看开源项目趋势，也能看中文技术圈在讨论什么。GitHub Trending 反映全球工程社区的关注点，V2EX 与 NodeSeek 反映国内一线工程师的实际问题，两者结合比单看一个平台更接近全貌。</p>

            <h2>六、常见问题</h2>
            <dl class="faq">
                ${faq.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}
            </dl>
        </section>`;

    return shell({
        title: `${h1} - 怎么用热榜找选题、追热点 | ${SITE_NAME}`,
        desc,
        keywords: ['今日热榜怎么用', '热榜找选题', '追热点工具', '自媒体选题', '舆情监测', '热点聚合站', '热搜榜使用', SITE_NAME, BRAND].join(','),
        canonical: `${SITE}/guide`,
        h1,
        crumbs: [{ text: h1 }],
        intro: `本站聚合 ${sources.length} 个平台的实时热榜。这份指南说明不同角色怎么把它用起来：自媒体找选题、运营追热点、品牌做舆情监测、开发者跟技术趋势。`,
        body,
        related: `<div class="rel-grid"><a class="rel-link" href="/boards">全部榜单</a><a class="rel-link" href="/all-hot">全网热搜总榜</a></div>`,
        lastmod: absTime(updated),
        ld: [
            {
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: faq.map(([q, a]) => ({
                    '@type': 'Question',
                    name: q,
                    acceptedAnswer: { '@type': 'Answer', text: a },
                })),
            },
            {
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
                    { '@type': 'ListItem', position: 2, name: h1, item: SITE + '/guide' },
                ],
            },
        ],
        cfg, sources, currentKey: null,
    });
}

/* 7. 每日归档 */
function renderDay(snapshot, sources, cfg) {
    const date = snapshot.date;
    const label = snapshot.label;
    const picks = snapshot.sources || [];

    const body = picks.map((s) => {
        const src = sources.find((x) => x.key === s.key) || { key: s.key, label: s.label, badge: '', icon: '' };
        const items = s.items || [];
        if (!items.length) return '';
        return `<section class="topic-src">
            <h3 class="topic-src-title"><a href="/board/${s.key}">${esc(boardName(src))}</a></h3>
            <ol class="b-list b-list-slim">${items.map((it, i) => {
                const rankCls = i < 3 ? ` r${i + 1}` : '';
                const hot = fmtHot(it.hot);
                return it.url
                    ? `<li class="b-item"><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"><span class="b-rank${rankCls}">${i + 1}</span><span class="b-main"><span class="b-title">${esc(it.title)}</span></span>${hot ? `<span class="b-hot">${hot}</span>` : ''}</a></li>`
                    : `<li class="b-item"><div><span class="b-rank${rankCls}">${i + 1}</span><span class="b-main"><span class="b-title">${esc(it.title)}</span></span>${hot ? `<span class="b-hot">${hot}</span>` : ''}</div></li>`;
            }).join('')}</ol>
        </section>`;
    }).join('');

    const h1 = `${label} 今日热榜回顾`;
    const title = `${label}今日热榜 - 当天全网热搜热点回顾 | ${SITE_NAME}`;
    const desc = `${label}的全网热榜回顾，收录当天微博热搜、百度热搜、抖音热榜、知乎热榜、今日头条等平台的榜单内容，共 ${picks.reduce((n, s) => n + (s.items || []).length, 0)} 条热点，可用于回顾当天发生过什么。`;

    return shell({
        title,
        desc,
        keywords: [`${label}热榜`, `${label}热搜`, '今日热榜', '热榜回顾', '当天热点', '历史热榜', SITE_NAME, BRAND].join(','),
        canonical: `${SITE}/today/${date}`,
        h1,
        crumbs: [{ text: '今日热榜归档', href: '/today/' }, { text: label }],
        intro: `${label}当天全网热点汇总，数据抓取于 ${esc(snapshot.updated)}。涵盖 ${picks.length} 个平台的榜单快照，共 ${picks.reduce((n, s) => n + (s.items || []).length, 0)} 条热点。`,
        body,
        related: `<div class="rel-grid"><a class="rel-link" href="/today/">热榜归档索引</a><a class="rel-link" href="/boards">全部榜单</a><a class="rel-link" href="/all-hot">全网热搜总榜</a></div>`,
        lastmod: `${date}`,
        ld: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: h1, description: desc, url: `${SITE}/today/${date}`,
            datePublished: date,
        },
        cfg, sources, currentKey: null,
    });
}

function renderTodayIndex(days, sources, cfg) {
    const h1 = '今日热榜归档';
    const list = days.map((d) => `<a class="day-link" href="/today/${d.date}"><span class="day-date">${esc(d.label)}</span><span class="day-count">${d.count} 条热点</span></a>`).join('');
    const desc = `今日热榜历史归档索引，按日期保存每天的全网热搜与热点榜单快照，共 ${days.length} 天记录，可回看任意一天的全网热点。`;

    const body = `${list ? `<div class="day-list">${list}</div>` : '<div class="b-empty">归档正在积累中，每天会新增一份当日快照。</div>'}
        <section class="guide-body">
            <h2>归档有什么用</h2>
            <p>热榜是「当下」的，过几个小时就翻篇了。归档把每天的榜单快照留了下来，用来回答「某个话题是哪天开始火的」「上周这个时候大家在讨论什么」这类问题。做选题复盘、写时间线、查证某个热点出现的时间点，都可以从这里翻。</p>
            <p>每天一份快照，包含当天微博热搜、百度热搜、抖音热榜、知乎热榜、今日头条等平台的榜单条目与热度值上限（每个平台取前 20 条），保留最近 90 天。点任意一天的日期即可回看当天的完整排名。</p>
        </section>`;

    return shell({
        title: `${h1} - 历史热榜每日快照 | ${SITE_NAME}`,
        desc,
        keywords: ['今日热榜归档', '历史热榜', '往期热榜', '每天热榜', '热榜回顾', '热搜历史记录', SITE_NAME, BRAND].join(','),
        canonical: `${SITE}/today/`,
        h1,
        crumbs: [{ text: h1 }],
        intro: `这里按日期保存每天的全网热点快照，共 ${days.length} 天。点进任意一天可以回看当天的微博热搜、百度热搜、抖音热榜与知乎热榜等全部榜单内容。`,
        body,
        related: `<div class="rel-grid"><a class="rel-link" href="/boards">全部榜单</a><a class="rel-link" href="/all-hot">全网热搜总榜</a></div>`,
        lastmod: days.length ? days[0].date : '',
        ld: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: h1, description: desc, url: `${SITE}/today/`,
            mainEntity: {
                '@type': 'ItemList',
                numberOfItems: days.length,
                itemListElement: days.slice(0, 50).map((d, i) => ({
                    '@type': 'ListItem', position: i + 1, name: `${d.label}今日热榜`,
                    url: `${SITE}/today/${d.date}`,
                })),
            },
        },
        cfg, sources, currentKey: null,
    });
}

/* 8. sitemap */
function renderSitemap(days, sources, updated) {
    const lastmod = (() => {
        const d = new Date(updated);
        if (isNaN(d)) return new Date().toISOString().slice(0, 10);
        return d.toISOString().slice(0, 10);
    })();
    const urls = [];
    const add = (loc, freq, prio, mod) => urls.push(
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${mod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`);

    add(`${SITE}/`, 'hourly', '1.0', lastmod);
    add(`${SITE}/all-hot`, 'hourly', '0.9', lastmod);
    add(`${SITE}/boards`, 'daily', '0.9', lastmod);
    for (const s of sources) add(`${SITE}/board/${s.key}`, 'hourly', '0.8', lastmod);
    for (const t of TOPICS) add(`${SITE}/topic/${t.slug}`, 'hourly', '0.7', lastmod);
    add(`${SITE}/today/`, 'daily', '0.6', lastmod);
    for (const d of days.slice(0, ARCHIVE_IN_SITEMAP)) add(`${SITE}/today/${d.date}`, 'monthly', '0.5', d.date);
    add(`${SITE}/guide`, 'weekly', '0.6', lastmod);

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function readJSON(p, fallback) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function collectDays(root) {
    const dir = path.join(root, 'data', 'archive');
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        const m = /^(\d{4})-(\d{2})-(\d{2})\.json$/.exec(f);
        if (!m) continue;
        const snap = readJSON(path.join(dir, f), null);
        if (!snap) continue;
        out.push({
            date: `${m[1]}-${m[2]}-${m[3]}`,
            label: `${Number(m[2])} 月 ${Number(m[3])} 日`,
            updated: snap.updated || '',
            sources: snap.sources || [],
            count: (snap.sources || []).reduce((n, s) => n + (s.items || []).length, 0),
        });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : -1));   // 新的在前
    return out;
}

function write(p, content) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
}

function run(opts) {
    const root = opts.root;
    const dist = opts.dist;

    const data = readJSON(path.join(root, 'data', 'hot.json'), null);
    if (!data || !Array.isArray(data.sources)) {
        throw new Error('data/hot.json 缺失或格式异常，预渲染中止');
    }
    const cfg = readJSON(path.join(root, 'data', 'config.json'), {});
    const sources = sortSources(data.sources);
    const updated = data.updated || new Date().toISOString();
    const days = collectDays(root);

    const stats = { index: 0, boards: 0, topics: 0, days: 0, texts: 0, urls: 0 };

    // 1) 首页
    const tpl = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const indexHTML = renderIndex(tpl, data, sources, cfg);
    write(path.join(dist, 'index.html'), indexHTML);
    stats.index = 1;

    // 2) 单平台页
    fs.mkdirSync(path.join(dist, 'board'), { recursive: true });
    for (const s of sources) {
        write(path.join(dist, 'board', `${s.key}.html`), renderBoard(s, sources, cfg, updated));
        stats.boards += 1;
    }

    // 3) 领域页
    fs.mkdirSync(path.join(dist, 'topic'), { recursive: true });
    for (const t of TOPICS) {
        write(path.join(dist, 'topic', `${t.slug}.html`), renderTopic(t, sources, cfg, updated));
        stats.topics += 1;
    }

    // 4) 聚合与导航页
    write(path.join(dist, 'all-hot.html'), renderAllHot(sources, cfg, updated));
    write(path.join(dist, 'boards.html'), renderBoards(sources, cfg, updated));
    write(path.join(dist, 'guide.html'), renderGuide(sources, cfg, updated));

    // 5) 归档
    fs.mkdirSync(path.join(dist, 'today'), { recursive: true });
    for (const d of days) {
        write(path.join(dist, 'today', `${d.date}.html`), renderDay(d, sources, cfg));
        stats.days += 1;
    }
    write(path.join(dist, 'today', 'index.html'), renderTodayIndex(days, sources, cfg));

    // 6) sitemap + IndexNow 校验文件
    write(path.join(dist, 'sitemap.xml'), renderSitemap(days, sources, updated));
    write(path.join(dist, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY + '\n');

    // 自检：首页正文字数（去掉 script/style/标签后）必须显著大于空壳
    const visible = indexHTML
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
    stats.texts = visible.length;
    stats.urls = 3 + sources.length + TOPICS.length + days.length + 1;

    console.log(`  预渲染: ${stats.urls} 个 URL  ` +
        `(首页 1 + 榜单页 ${stats.boards} + 领域页 ${stats.topics} + 归档 ${stats.days} + 索引/指南 4)`);
    console.log(`  首页可见正文: ${stats.texts} 字符  |  sitemap: dist/sitemap.xml`);

    if (stats.texts < 5000) {
        throw new Error(`首页预渲染正文只有 ${stats.texts} 字符，疑似失败`);
    }

    return stats;
}

module.exports = { run, INDEXNOW_KEY, SITE };
