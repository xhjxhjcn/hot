# 今日热榜 · hot.xhja.cn

全网热点聚合站。**数据直接从各平台官方公开接口抓取**，不经过任何第三方聚合服务。

- 前端：纯静态（原生 HTML / CSS / JS，无框架；`npm run build` 只做文件复制，见下文）
- 数据：GitHub Actions 定时运行 `scripts/fetch_hot.py`，把结果写进 `data/hot.json`
- 部署：阿里云 ESA（仓库根目录已带 `esa.jsonc`；`edgeone.json` 作为多云备份）

## 部署（阿里云 ESA）

`build-dist.js` 把站点原样复制到 `dist/`，ESA 发布的是 `dist/`。
这一步不能省 —— ESA「函数和 Pages」没有零构建自动识别，默认套
`npm install` + `npm run build` + 输出 `./dist`，而 `esa.jsonc` 里
**`buildCommand` 写空字符串不等于「跳过构建」**，ESA 会退回默认的 `npm run build`，
此时仓库没有 `package.json`，构建直接报 `ENOENT: package.json` 失败。

因此这里给一个真实存在的构建脚本，让两条路径都能过：

| 场景 | 结果 |
| --- | --- |
| `esa.jsonc` 被识别 | `npm run build` → `dist/` → 发布 `./dist` |
| `esa.jsonc` 被忽略 | 控制台默认 `npm install && npm run build` → `dist/` → 发布 `./dist`（ESA 默认输出目录） |

另外两条注意事项：

- **`esa.jsonc` 必须是严格 JSON，不能写 `//` 注释**（扩展名是 .jsonc 也没用），
  否则 ESA 解析失败会静默忽略整个文件并退回默认配置。
- `dist/` 已在 `.gitignore` 里，由构建现场生成，不要提交。

本地验证构建：`npm run build`（零依赖，无需 `npm install`）。

## 交互说明

- **卡片顺序**：由 `assets/app.js` 的 `SOURCE_ORDER` 决定 —— 微博第一、今日头条第二，
  其余按大众关注度递减；没列进去的源（以后新增的平台）排最后并保持源站顺序。
  排序只影响展示，`data/hot.json` 里的原始顺序不动。
- **卡片**：一张卡 = 一个平台，**固定展示前 8 条、不做卡内滚动**
  （小框里上下滑极易误点开链接），底部「查看全部 N 条」进弹窗看全量。
  条数常量是 `app.js` 与 `prerender.js` 里各自的 `CARD_ITEMS`（必须一致）。
  卡头是「图标 + 平台名 + 榜单类型 + 条目数」，卡底是「更新时间 + 查看全部」；
  条目数、榜单类型、更新时间全部来自 `data/hot.json`，没有则不显示，不补假值。
- **标题两行截断**：`-webkit-line-clamp: 2`。原来为了四列齐平把标题压成一行，
  知乎 / IT之家 / 36氪 这类 30 字标题几乎全被切掉；现在给两行，条数从 10 收到 8，
  卡片总高度基本持平而可读性明显更好。完整标题在 `title` 属性与弹窗里。
- **排名**：1~3 名给一点底色（红 / 橙 / 琥珀），4 名以后一律中性灰；热度只在有值
  时显示，缺热度不显示「0」。筛选后**排名仍是它在原榜单里的位次**，不会变成第 1 名。
- **搜索框承担两件事**：
  1. 输入时**即时筛选本站全部条目**（标题 + 摘要，命中处高亮），并显示
     「在 N 个平台找到 M 条」；没有结果给空状态与一键清除；
  2. **回车 / 点「搜全网」**才提交给搜索引擎（百度 / 必应 / 谷歌可切，记忆在
     localStorage），新标签页打开。`Esc` 或 × 清空关键词。
- **分类筛选**：`data/taxonomy.json` 是唯一数据源（`categories` 定义顺序与名称，
  `map` 定义平台 → 分类）。首页分类 chip 与页脚分组索引都从这里读，**能真筛**：
  切到「科技」后只剩该分类的平台卡片。分类拉不到时 chip 整行不渲染，不留假按钮。
  当前分类记忆在 localStorage。
- **平台快速导航**：桌面是一行可横滑的 chip（12 个主力平台），移动端折叠成
  「平台 ▾」面板（全部 32 个，带条目数）。点击滚到对应卡片并短暂高亮；
  若当时有分类 / 关键词筛选，会先重置筛选再跳转。
- **刷新**：全站只有页头一个刷新入口。它带 `?t=` 重新拉一次 `data/hot.json`，
  绕过浏览器与边缘缓存；**不能**触发服务端重新抓取（抓取由 Actions 定时跑）。
  拉到的 `updated` 和当前一致时只提示「已是最新」，不重绘 —— 避免整页闪一下；
  失败则保留上一次有效数据，仅 toast 报错。刷新期间页头走一条 2px 进度线，
  不改变布局。
- **详情弹窗**：点「查看全部」在**本页**弹出（不跳页、不撑高卡片），展示该平台
  全部条目。三种关闭方式：关闭按钮 / 点遮罩 / `Esc`；打开时锁定滚动并补偿滚动条
  宽度，关闭后焦点交还给触发按钮；`Tab` 在弹窗内循环。手机端（≤640px）改成底部抽屉。
- **页眉**：站点导航（全部榜单 / 全网总榜 / 使用指南）+ 实时时钟与农历 +
  深浅色切换 + 刷新。滚动后加一行浅阴影，不遮挡内容。
- **吸顶筛选条**：分类 + 平台导航在滚动时吸在页眉下方（`top: var(--header-h)`），
  跳转定位时已按「页眉 + 筛选条」高度做偏移，目标卡片不会被盖住。
- **深色模式**：全部颜色走 CSS 变量（底、卡片、文字、边框、输入框、悬停、选中、
  焦点环、弹窗、骨架屏），`color-scheme` 与 `theme-color` 同步切换。


## 目录结构

```
├── index.html                  首页「模板」——构建期由 prerender 填充后写入 dist/
├── assets/
│   ├── style.css               设计系统（浅灰白 + 白色卡片 + 靛蓝强调 + 深色模式）+ 子页样式
│   ├── app.js                  数据加载、卡片渲染、分类筛选、站内搜索/全网搜索、主题
│   ├── lunar.js / lunar-data.js 轻量农历（顶部时钟用）
│   └── logo.png                行恒简安 logo
├── data/
│   ├── hot.json                抓取产物（由 Actions 自动更新，勿手改）
│   ├── archive/                每日快照（每天一份，保留 90 天，不发布到站点）
│   ├── taxonomy.json           平台分类规则（分类 chip 与页脚分组索引的唯一数据源）
│   └── config.json             备案号等站点配置
├── logos/                      各平台图标
├── scripts/
│   ├── fetch_hot.py            抓取器（零依赖，仅标准库）
│   ├── prerender.js            预渲染：生成全部静态页面、sitemap、IndexNow 文件
│   ├── verify_seo.py           构建产物自检（标签配平 / 内链 / sitemap / 内容量）
│   ├── dispatch_hot.py         ECS 侧 dispatch 脚本的版本源（见「更新频率」）
│   └── probe.py                单源调试工具（定位接口 / 修正正则）
├── build-dist.js               构建脚本：复制静态资源 → 调 prerender → 输出 dist/
├── package.json                仅提供 build 脚本，无任何依赖
├── .github/workflows/update.yml 定时抓取 + IndexNow 推送
└── esa.jsonc / edgeone.json    部署配置
```

`dist/` 是构建产物（已进 `.gitignore`），不提交到仓库。

## SEO：为什么首页是「模板」而不是成品

站点原本是纯前端渲染：`index.html` 里只有一个空的 `#hotGrid`，32 个榜单全靠 `app.js`
拉 `data/hot.json` 后注入。爬虫不执行 JS，读到的正文只有 176 个字符，全站也只有一个
可索引 URL —— 搜索「今日热榜」能排在 7~8 位，但任何长尾词（微博热搜榜、抖音热榜…）
都进不来。

改法是**构建期预渲染**：`build-dist.js` 复制完静态资源后调用 `scripts/prerender.js`，
把 `data/hot.json` 的内容直接写进 HTML。产物：

| 路径 | 内容 | 主攻词 |
|---|---|---|
| `/` | 32 张榜单卡片（首屏即可见，非骨架屏） | 今日热榜、全网热榜 |
| `/board/<key>` × 32 | 单平台完整榜单 | 微博热搜榜、抖音热榜、知乎热榜… |
| `/topic/<slug>` × 10 | 领域聚合（科技 / 程序员 / 新闻 / 娱乐…） | 科技热榜、程序员热榜 |
| `/all-hot` | 跨平台按热度合并去重的前 100 条 | 全网热搜榜、实时热搜 |
| `/boards` | 全部榜单导航（内链枢纽） | 热榜导航、热搜榜大全 |
| `/guide` | 使用指南 + FAQ（带 FAQPage 结构化数据） | 今日热榜怎么用、找选题 |
| `/today/<日期>` | 每日快照归档 | 10 月 15 日热榜 |
| `/sitemap.xml` | 上面全部的索引 | — |

⚠ **对外地址一律不带 `.html`。** 阿里云 ESA 的 Pages 开了「自动去除 .html」：
访问 `/boards.html` 会 307 跳到 `/boards`，而 `/boards` 直接 200。所以 canonical、
sitemap、站内链接、JSON-LD 里的 URL **全部**用不带后缀的形式 —— 否则每个链接都白吃
一跳、sitemap 还会塞满重定向地址、canonical 指向重定向页。磁盘上文件仍按 `.html`
落盘，旧索引过的 `.html` 地址靠平台自身的 307 照样能进。目录型页面保留结尾斜杠
（`/today` 会 307 到 `/today/`）。`verify_seo.py` 里有对应断言，写了 `.html` 会直接报错。

四个必须知道的约束：

1. **不要往 `build-dist.js` 的 `FILES` 里加 `index.html`**。它是模板，不是产物；
   直接复制会把预渲染结果覆盖成空壳。
2. **`index.html` 里的锚点是契约**。`prerender.js` 按精确字符串替换
   `#statPlatforms` / `#statItems` / `#statUpdated` / `#dataTime` / `#hotGrid` /
   `#footerLinks` / `#footerBeian` / `#boardNav` / `<!--PRERENDER:ITEMLIST-->` /
   `#year`，改模板时这些锚点必须原样保留，否则构建会直接报错
   （这是故意的，宁可构建失败也不要静默产出空壳）。
3. **卡片的预渲染标记要和 `app.js` 的 `cardHTML()` 保持一致**。用户首屏看到的是
   预渲染 DOM，`app.js` 拉完数据后会原地重渲染一遍，结构不同就会跳版。
   卡片标记在 `app.js` 与 `prerender.js` 里**各有一份**，改一处必须改另一处。
4. **对外 URL 不带 `.html`**（见上）。

日常校验：

```bash
npm run build                                    # 复制 + 预渲染
python scripts/verify_seo.py                     # 产物自检，全绿才算过
```

IndexNow 的密钥写在 `prerender.js` 的 `INDEXNOW_KEY`，构建时生成同名的
`dist/<key>.txt` 供 Bing 校验；Actions 在推送数据后读同一个常量 POST 给
`api.indexnow.org`，让 Bing 主动来抓，而不是等爬虫自己发现。

## 本地开发

```bash
# 抓取全部源（写入 data/hot.json）
python scripts/fetch_hot.py

# 只抓某几个源，便于调试
python scripts/fetch_hot.py baidu weibo zhihu

# 列出所有源
python scripts/fetch_hot.py --list

# 本机网络受限时调小超时，避免被墙外源拖慢
HOT_TIMEOUT=6 python scripts/fetch_hot.py

# 起本地预览（必须走 HTTP，直接双击 index.html 会因 file:// 的 CORS 限制读不到 json）
npm run build && cd dist && python -m http.server 8899
```

想直接看源码目录而不构建也行，根目录本身就是一份可直接服务的站点：
`python -m http.server 8899`（工作目录留在仓库根目录）。

## 数据格式

`data/hot.json`：

```jsonc
{
  "updated": "2026-09-20T22:02:23+08:00",  // 抓取完成时间（北京时间）
  "total": 32,
  "ok": 32,                                 // 成功抓到数据的源数
  "sources": [
    {
      "key": "baidu",
      "label": "百度",
      "badge": "热搜",
      "link": "https://top.baidu.com/board?tab=realtime",
      "icon": "logos/baidu.png",
      "ok": true,
      "count": 50,
      "error": null,
      "elapsed": 0.21,
      "items": [
        { "title": "…", "url": "https://…", "hot": 7807974, "desc": "…" }
      ]
    }
  ]
}
```

单个源失败不会影响其他源，只会让该卡片刻显示「暂时没有抓到数据」。

## 已接入的平台

共 32 个源。首页的分类 chip 与页脚的分组索引都读 `data/taxonomy.json`，
一个平台可以同时属于多个分类（例如知乎 = 社会 / 科技 / 社区）：

| 分类 | 平台 |
| --- | --- |
| 社会 | 微博、百度、抖音、今日头条、知乎、腾讯新闻、新浪新闻、网易新闻、澎湃新闻、新浪、纽约时报 |
| 科技 | 知乎、IT之家、CSDN、掘金、36氪、少数派、GitHub、HelloGitHub、Hacker News、果壳、爱范儿、V2EX、NodeSeek |
| 财经 | 36氪、新浪新闻 |
| 娱乐 | 微博、抖音、哔哩哔哩（排行榜 / 热搜）、豆瓣电影、AcFun、新浪、百度贴吧 |
| 游戏 | 哔哩哔哩（排行榜 / 热搜）、AcFun、虎扑、游研社、百度贴吧 |
| 社区 | 百度贴吧、虎扑、V2EX、NodeSeek、知乎、CSDN |
| 生活 | 知乎日报、果壳、历史上的今天、少数派、爱范儿 |

> 新增源时记得在 `data/taxonomy.json` 的 `map` 里补一条，否则它只会出现在「综合」里。

> V2EX / NodeSeek / 纽约时报 / GitHub 在中国大陆网络下不可直连，本地跑会失败，
> 在 GitHub Actions（海外出口）上正常。这是预期行为，不是 bug。

### 未接入的平台

什么值得买、吾爱破解、51CTO、虎嗅、数字尾巴、水木社区、NGA、极客公园、微信读书、豆瓣小组、
天气预警、IT之家喜加一、米哈游系（原神 / 星穹铁道 / 崩坏3 / 米游社）、LINUX DO ——
这些站点或已上 WAF / 滑块验证码，或需要客户端签名，公开接口抓不到。

其中 **LINUX DO** 的抓取逻辑已经写好（`_linuxdo_api` / `_linuxdo_rss`），
但它的 Cloudflare 对数据中心 IP 一律返回 403（JSON 与 RSS 都一样），GitHub Actions 抓不到。
若将来改用自建 runner（住宅 IP），把 `SOURCES` 里那行注释取消即可恢复（图标 `logos/linuxdo.png` 已保留）。

## 新增一个源

1. 在 `scripts/fetch_hot.py` 里写一个 `s_xxx()` 函数，返回 `mk(title, url, hot, desc)` 组成的列表；
2. 把 `('xxx', '显示名', '徽标', '官网地址', s_xxx, False)` 加进 `SOURCES`；
3. 把图标放到 `logos/xxx.png`；
4. `python scripts/fetch_hot.py xxx` 验证。

找接口时用 `python scripts/probe.py <url>` 看返回结构和页面里的链接模式。

## 更新频率

**主触发（ECS crontab）** —— ECS `115.29.227.163` 每 30 分钟调一次 GitHub 的
`workflow_dispatch` API，主动唤醒 `update.yml`：

    # crontab 条目（与 /tmp/xhj-moments-index.lock 那条错开分钟）
    5,35 * * * * flock -n /tmp/xhj-hot-dispatch.lock \
      /usr/bin/python3 /opt/xhj-hot-dispatch/dispatch_hot.py --quiet \
      >> /var/log/hot-dispatch.log 2>&1        # hot-dispatch

脚本与凭据放在 `/opt/xhj-hot-dispatch/`（`config.json` 存 PAT，权限 600）。
仓库内 `scripts/dispatch_hot.py` 是它的版本源（**不含**凭据，部署时另建
`config.json`）。
脚本自带防重复保护：上一次 run 仍在 `in_progress` / `queued` 时自动跳过，
不会把 Actions 额度烧在排队上。

### 为什么不用 GitHub 自带的 `schedule`

GitHub Actions 对**低活跃仓库**（长期只有 bot 提交）的定时触发会严重降级。
2026-10-13 实测 `update.yml` 的实际运行间隔为 3.3 ~ 9.9 小时（平均约 7 小时），
仅为 `cron: '5,35 * * * *'` 声明频率的 ~7%，导致站点长期展示数小时前的旧热点
——当天与微博实时热搜前 20 条的**重合度一度为 0/20**。改用外部触发后恢复到
每 30 分钟更新，重合度回到 18/20。

`update.yml` 里的 `schedule` 保留作为兜底（万一 ECS 或网络故障）；两个触发源由
workflow 的 `concurrency: update-hot`（`cancel-in-progress: false`）串行化，
不会并发打架。

### 额度

单次运行约 20 秒，按 1 分钟计费；每 30 分钟一次 ≈ 1440 分钟/月，加兜底
`schedule` 约 1500 分钟/月，仍在私有仓库免费额度（2000 分钟/月）以内。
