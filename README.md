# 今日热榜 · hot.xhja.cn

全网热点聚合站。**数据直接从各平台官方公开接口抓取**，不经过任何第三方聚合服务。

- 前端：纯静态（原生 HTML / CSS / JS，无框架、无构建步骤）
- 数据：GitHub Actions 定时运行 `scripts/fetch_hot.py`，把结果写进 `data/hot.json`
- 部署：阿里云 ESA（仓库根目录已带 `esa.jsonc`；`edgeone.json` 作为多云备份）

## 目录结构

```
├── index.html                  页面骨架
├── assets/
│   ├── style.css               设计系统（浅蓝渐变 + 毛玻璃 + 深色模式）
│   ├── app.js                  数据加载、卡片渲染、搜索筛选、主题
│   ├── lunar.js / lunar-data.js 轻量农历（顶部时钟用）
│   └── logo.png                行恒简安 logo
├── data/
│   ├── hot.json                抓取产物（由 Actions 自动更新，勿手改）
│   └── config.json             备案号等站点配置
├── logos/                      各平台图标
├── scripts/
│   ├── fetch_hot.py            抓取器（零依赖，仅标准库）
│   └── probe.py                单源调试工具（定位接口 / 修正正则）
├── .github/workflows/update.yml 定时抓取
└── esa.jsonc / edgeone.json    部署配置
```

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
python -m http.server 8899
```

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

`update.yml` 每小时的第 5、35 分钟各跑一次（UTC）。GitHub 的定时任务有排队延迟，
实际执行时间可能晚几分钟，属正常现象。
