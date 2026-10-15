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
- **卡片**：一张卡 = 一个平台，**固定展示前 10 条、不做卡内滚动**
  （小框里上下滑极易误点开链接），底部「查看全部 N 条」进弹窗看全量。
  条数常量是 `app.js` 的 `CARD_ITEMS`。
- **卡片内只显示标题，且压成一行**：两条都是为了让卡片高度只由「条数」决定
  （10 条 = 恒定 466px），四列才齐平：
  1. **摘要不进卡片** —— 百度 / 知乎 / 澎湃 / 腾讯 / 网易等源的每条都带一段 `desc`，
     在卡里要多占一行，10 条就是 10 行，整列比微博 / 头条高出一大截；
  2. **长标题压成一行** —— 知乎 / IT之家 等源标题动辄 30 字，占两行同样把整列撑高。
  完整标题与摘要都在「查看全部」弹窗里；卡片上悬停也有 `title` 原生提示。
  （短标签「沸 / 热 / 新」仍与标题同行显示）
- **详情弹窗**：点「查看全部」在**本页**弹出详情窗口（不跳页、也不把卡片撑高），
  展示该平台的全部条目。三种关闭方式：关闭按钮 / 点遮罩 / 按 `Esc`；
  弹窗底部只留「前往官网」。打开时页面滚动锁定并补偿滚动条宽度，
  关闭后焦点交还给触发按钮。手机端（≤640px）自动改成从底部升起的抽屉。
  动效：遮罩淡入淡出 + 面板回弹（`cubic-bezier(.16,1,.3,1)`）+ 条目错峰上浮
  （延迟 `--i * 16ms`，封顶 18 档）。
- **搜索**：页头搜索框是**全网搜索**，直接提交给搜索引擎（百度 / 必应 / 谷歌可切，
  选择记在 localStorage），不做站内过滤 —— 站内只能在本页 32 张卡片里找，
  对用户价值太低，已撤掉。
- **刷新**：全站只有页头一个刷新入口。它带 `?t=` 重新拉一次 `data/hot.json`，
  绕过浏览器与边缘缓存；**不能**触发服务端重新抓取（抓取由 Actions 定时跑）。
  卡片与弹窗上原本各有一个 ⟳，实际刷的都是全部榜单而非那一个，已删除。
- **分类标签**（全部 / 榜单 / 资讯 / 社区）已撤掉：只是粗分类，价值不如卡片
  本身按关注度排好的顺序。按领域浏览走 `/boards.html` 与 `/topic/*`。
- **分类**：全部 / 榜单 / 资讯 / 社区。
- **页眉**：实时时钟 + 农历、快速定位到指定平台、深浅色主题切换（记忆在 localStorage）。

## 目录结构

```
├── index.html                  首页「模板」——构建期由 prerender 填充后写入 dist/
├── assets/
│   ├── style.css               设计系统（浅蓝渐变 + 毛玻璃 + 深色模式）+ 子页样式
│   ├── app.js                  数据加载、卡片渲染、全网搜索框、主题
│   ├── lunar.js / lunar-data.js 轻量农历（顶部时钟用）
│   └── logo.png                行恒简安 logo
├── data/
│   ├── hot.json                抓取产物（由 Actions 自动更新，勿手改）
│   ├── archive/                每日快照（每天一份，保留 90 天，不发布到站点）
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
| `/board/<key>.html` × 32 | 单平台完整榜单 | 微博热搜榜、抖音热榜、知乎热榜… |
| `/topic/<slug>.html` × 10 | 领域聚合（科技 / 程序员 / 新闻 / 娱乐…） | 科技热榜、程序员热榜 |
| `/all-hot.html` | 跨平台按热度合并去重的前 100 条 | 全网热搜榜、实时热搜 |
| `/boards.html` | 全部榜单导航（内链枢纽） | 热榜导航、热搜榜大全 |
| `/guide.html` | 使用指南 + FAQ（带 FAQPage 结构化数据） | 今日热榜怎么用、找选题 |
| `/today/<日期>.html` | 每日快照归档 | 10 月 15 日热榜 |
| `/sitemap.xml` | 上面全部的索引 | — |

三个必须知道的约束：

1. **不要往 `build-dist.js` 的 `FILES` 里加 `index.html`**。它是模板，不是产物；
   直接复制会把预渲染结果覆盖成空壳。
2. **`index.html` 里的锚点是契约**。`prerender.js` 按精确字符串替换
   `#overviewSub` / `#hotGrid` / `#footerLinks` / `#footerBeian` / `#boardNav` /
   `<!--PRERENDER:ITEMLIST-->`，改模板时这些锚点必须原样保留，否则构建会直接报错
   （这是故意的，宁可构建失败也不要静默产出空壳）。
3. **卡片的预渲染标记要和 `app.js` 的 `cardHTML()` 保持一致**。用户首屏看到的是
   预渲染 DOM，`app.js` 拉完数据后会原地重渲染一遍，结构不同就会跳版。
   卡片标记在 `app.js` 与 `prerender.js` 里**各有一份**，改一处必须改另一处。

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

| 分类 | 平台 |
| --- | --- |
| 榜单 | 百度、微博、抖音、今日头条、知乎、哔哩哔哩（排行榜 / 热搜）、虎扑、豆瓣电影、AcFun、CSDN、掘金、GitHub、HelloGitHub、Hacker News |
| 资讯 | 腾讯新闻、新浪新闻、网易新闻、澎湃新闻、新浪、IT之家、36氪、爱范儿、知乎日报、果壳、游研社、历史上的今天、纽约时报 |
| 社区 | 百度贴吧、少数派、V2EX、NodeSeek |

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
