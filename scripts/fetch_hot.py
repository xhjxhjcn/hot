#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
今日热榜 · 数据抓取器（零依赖，仅用 Python 标准库）

直接从各平台官方接口/页面抓取榜单，不依赖任何第三方聚合 API。
输出：data/hot.json

用法：
    python scripts/fetch_hot.py                 # 抓取全部源
    python scripts/fetch_hot.py baidu weibo     # 只抓指定源（调试用）
    python scripts/fetch_hot.py --list          # 列出所有源
"""

import gzip
import io
import json
import os
import re
import socket
import ssl
import sys
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape
from urllib import error, parse, request

CST = timezone(timedelta(hours=8))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, 'data', 'hot.json')

UA_MOBILE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
             'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
UA_PC = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE
_OPENER = request.build_opener(
    request.ProxyHandler({}),          # 显式清空代理，避免被本机/CI 代理截走
    request.HTTPSHandler(context=_SSL_CTX),
)
socket.setdefaulttimeout(20)

# 单请求超时（秒）。本机调试时可调小，避免被墙外源拖慢：
#   HOT_TIMEOUT=6 python scripts/fetch_hot.py
DEFAULT_TIMEOUT = int(os.environ.get('HOT_TIMEOUT', '20'))


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
def _smart_decode(raw, content_type=''):
    m = re.search(r'charset=([\w-]+)', content_type or '', re.I)
    if m:
        try:
            return raw.decode(m.group(1), 'replace')
        except LookupError:
            pass
    for enc in ('utf-8', 'gb18030', 'gbk'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


def http_get(url, headers=None, timeout=None, retries=2, data=None):
    if timeout is None:
        timeout = DEFAULT_TIMEOUT
    hdr = {
        'User-Agent': UA_PC,
        'Accept': 'application/json, text/plain, text/html, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'close',
    }
    if headers:
        hdr.update(headers)
    last = None
    for attempt in range(retries + 1):
        try:
            req = request.Request(url, headers=hdr, data=data)
            with _OPENER.open(req, timeout=timeout) as resp:
                raw = resp.read()
                enc = (resp.headers.get('Content-Encoding') or '').lower()
                if 'gzip' in enc:
                    raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
                elif 'deflate' in enc:
                    try:
                        raw = zlib.decompress(raw)
                    except zlib.error:
                        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
                return _smart_decode(raw, resp.headers.get('Content-Type', ''))
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                time.sleep(1.2 * (attempt + 1))
    raise last


def http_json(url, headers=None, timeout=None, retries=2, data=None):
    return json.loads(http_get(url, headers=headers, timeout=timeout, retries=retries, data=data))


def http_post_json(url, payload, headers=None, timeout=None, retries=1):
    hdr = {'Content-Type': 'application/json'}
    if headers:
        hdr.update(headers)
    return json.loads(http_get(url, headers=hdr, timeout=timeout, retries=retries,
                               data=json.dumps(payload).encode('utf-8')))


# ----------------------------------------------------------------------------
# 工具
# ----------------------------------------------------------------------------
_TAG_RE = re.compile(r'<[^>]+>')
_WS_RE = re.compile(r'[ \t\u00a0\u3000]+')


def strip_tags(s):
    if not s:
        return ''
    return _WS_RE.sub(' ', unescape(_TAG_RE.sub('', str(s)))).strip()


def clip(s, n=90):
    s = strip_tags(s)
    return s if len(s) <= n else s[:n - 1] + '…'


def pick(d, *keys, default=''):
    """从 dict 里按候选键取值（大小写不敏感）。"""
    if not isinstance(d, dict):
        return default
    lowered = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        if k in d and d[k] not in (None, ''):
            return d[k]
        lk = str(k).lower()
        if lk in lowered and lowered[lk] not in (None, ''):
            return lowered[lk]
    return default


def to_int(v):
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    m = re.search(r'[\d.]+', str(v).replace(',', ''))
    if not m:
        return 0
    try:
        return int(float(m.group()))
    except ValueError:
        return 0


def to_cn_num(v):
    """把「948 万热度」「1.2亿」这类中文计数换算成整数。"""
    if v is None:
        return 0
    s = str(v)
    m = re.search(r'([\d.]+)\s*(亿|万)?', s.replace(',', ''))
    if not m:
        return 0
    try:
        n = float(m.group(1))
    except ValueError:
        return 0
    unit = m.group(2)
    if unit == '亿':
        n *= 1e8
    elif unit == '万':
        n *= 1e4
    return int(n)


def mk(title, url='', hot=0, desc=''):
    title = clip(title, 100)
    desc = clip(desc, 160)
    # 摘要与标题高度重合时丢掉，避免同一句话显示两遍（知乎等源常见）
    if desc:
        a, b = title[:22], desc[:22]
        if a and b and (a.startswith(b) or b.startswith(a)):
            desc = ''
    return {'title': title, 'url': (url or '').strip(),
            'hot': to_int(hot), 'desc': desc}


def dedup(items):
    seen, out = set(), []
    for it in items:
        if not it or not it.get('title'):
            continue
        if it['title'] in seen:
            continue
        seen.add(it['title'])
        out.append(it)
    return out


def html_links(html, pattern, base='', min_title=6, group_url=1, group_title=2):
    """按正则从 HTML 里批量抽链接+标题。pattern 需含两个捕获组。"""
    out = []
    for m in re.finditer(pattern, html, re.S):
        title = strip_tags(m.group(group_title))
        if len(title) < min_title:
            continue
        url = m.group(group_url)
        if base and not url.startswith('http'):
            url = base + url
        out.append(mk(title, url))
    # JSON 内嵌页面里斜杠常被转义
    if not out and '\\/' in html:
        return html_links(html.replace('\\/', '/'), pattern, base, min_title, group_url, group_title)
    return out


def html_cards(html, href_pat, title_pats, base='', window=1200, min_title=8):
    """卡片式列表：锚点常先包一张图，标题在其后的兄弟节点里。
    对每个 href 命中点，向后开一个窗口，依次试 title_pats。"""
    out = []
    for m in re.finditer(href_pat, html, re.S):
        seg = html[m.end():m.end() + window]
        title = ''
        for tp in title_pats:
            tm = re.search(tp, seg, re.S)
            if tm:
                cand = strip_tags(tm.group(1))
                if len(cand) >= min_title:
                    title = cand
                    break
        if not title:
            continue
        url = m.group(1)
        if base and not url.startswith('http'):
            url = base + url
        out.append(mk(title, url))
    return dedup(out)


# ----------------------------------------------------------------------------
# 各平台抓取器
# ----------------------------------------------------------------------------
def s_baidu():
    # pc 端接口才带 hotScore / desc，wise 端只有标题
    d = http_json('https://top.baidu.com/api/board?platform=pc&tab=realtime',
                  headers={'Referer': 'https://top.baidu.com/board?tab=realtime'})
    items = []
    for card in pick(pick(d, 'data', default={}), 'cards', default=[]):
        content = pick(card, 'content', default=[])
        rows = []
        for c in content:
            if isinstance(c, dict) and isinstance(c.get('content'), list):
                rows.extend(c['content'])
            elif isinstance(c, dict):
                rows.append(c)
        for it in rows:
            items.append(mk(pick(it, 'word', 'query', 'title'),
                            pick(it, 'rawUrl', 'url', 'appUrl'),
                            pick(it, 'hotScore', default=0),
                            pick(it, 'desc')))
    return items


def s_weibo():
    d = http_json('https://weibo.com/ajax/side/hotSearch',
                  headers={'Referer': 'https://weibo.com/', 'X-Requested-With': 'XMLHttpRequest'})
    items = []
    for it in pick(pick(d, 'data', default={}), 'realtime', default=[]):
        if pick(it, 'is_ad', default=0):
            continue
        word = pick(it, 'word', 'note')
        items.append(mk(word, 'https://s.weibo.com/weibo?q=' + parse.quote('#' + str(word) + '#'),
                        pick(it, 'num', 'raw_hot', default=0),
                        pick(it, 'label_name')))
    return items


def s_zhihu():
    d = http_json('https://api.zhihu.com/topstory/hot-list?limit=50&reverse_order=0',
                  headers={'User-Agent': UA_MOBILE, 'Referer': 'https://www.zhihu.com/'})
    items = []
    for it in pick(d, 'data', default=[]):
        tgt = pick(it, 'target', default={})
        qid = pick(tgt, 'id')
        url = str(pick(tgt, 'url')).replace('api.zhihu.com/questions', 'www.zhihu.com/question')
        if not url.startswith('http') and qid:
            url = 'https://www.zhihu.com/question/' + str(qid)
        items.append(mk(pick(tgt, 'title'), url,
                        to_cn_num(pick(it, 'detail_text'))))   # 形如「948 万热度」
    return items


def s_douyin():
    d = http_json('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/',
                  headers={'User-Agent': UA_MOBILE, 'Referer': 'https://www.douyin.com/'})
    items = []
    for it in pick(d, 'word_list', default=[]):
        word = pick(it, 'word')
        items.append(mk(word, 'https://www.douyin.com/search/' + parse.quote(str(word)),
                        pick(it, 'hot_value', default=0)))
    return items


def s_toutiao():
    d = http_json('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
                  headers={'Referer': 'https://www.toutiao.com/'})
    return [mk(pick(it, 'Title', 'title'), pick(it, 'Url', 'url'), pick(it, 'HotValue', default=0))
            for it in pick(d, 'data', default=[])]


def s_bilibili():
    d = http_json('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
                  headers={'Referer': 'https://www.bilibili.com/v/popular/rank/all',
                           'Origin': 'https://www.bilibili.com'})
    items = []
    for it in pick(pick(d, 'data', default={}), 'list', default=[]):
        owner = pick(it, 'owner', default={})
        items.append(mk(pick(it, 'title'),
                        'https://www.bilibili.com/video/' + str(pick(it, 'bvid')),
                        pick(pick(it, 'stat', default={}), 'view', default=0),
                        owner.get('name', '') if isinstance(owner, dict) else ''))
    return items


def s_bilibili_hot():
    d = http_json('https://api.bilibili.com/x/web-interface/wbi/search/square?limit=30',
                  headers={'Referer': 'https://www.bilibili.com/',
                           'Origin': 'https://www.bilibili.com'})
    trend = pick(pick(d, 'data', default={}), 'trending', default={})
    items = []
    for it in pick(trend, 'list', default=[]):
        kw = pick(it, 'keyword', 'show_name')
        items.append(mk(kw, 'https://search.bilibili.com/all?keyword=' + parse.quote(str(kw)),
                        pick(it, 'heat_score', default=0)))
    return items


def s_github():
    html = http_get('https://github.com/trending?since=daily', headers={'Accept': 'text/html'})
    items = []
    for block in re.split(r'<article class="Box-row"', html)[1:]:
        m = re.search(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"', block)
        if not m:
            continue
        parts = [p for p in m.group(1).replace('\n', '').replace(' ', '').split('/') if p]
        if len(parts) < 2:
            continue
        name = '/'.join(parts[-2:])
        desc_m = re.search(r'<p class="col-9 color-fg-muted[^"]*"[^>]*>(.*?)</p>', block, re.S)
        star_m = re.search(r'stargazers"[^>]*>\s*([\d,]+)', block)
        items.append(mk(name, 'https://github.com/' + name,
                        star_m.group(1) if star_m else 0,
                        desc_m.group(1) if desc_m else ''))
    return items


def s_v2ex():
    d = http_json('https://www.v2ex.com/api/topics/hot.json',
                  headers={'Referer': 'https://www.v2ex.com/'})
    items = []
    for it in (d if isinstance(d, list) else []):
        node = pick(it, 'node', default={})
        items.append(mk(pick(it, 'title'), pick(it, 'url'),
                        pick(it, 'replies', default=0),
                        node.get('title', '') if isinstance(node, dict) else ''))
    return items


def s_hackernews():
    ids = http_json('https://hacker-news.firebaseio.com/v0/topstories.json')[:30]
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(
            lambda i: http_json(f'https://hacker-news.firebaseio.com/v0/item/{i}.json', retries=1),
            ids))
    items = []
    for it in results:
        if not it or not it.get('title'):
            continue
        items.append(mk(it['title'],
                        it.get('url') or f"https://news.ycombinator.com/item?id={it.get('id')}",
                        it.get('score', 0), f"{it.get('descendants', 0)} 条评论"))
    return items


def s_ithome():
    html = http_get('https://www.ithome.com/list/', headers={'Referer': 'https://www.ithome.com/'})
    return html_links(html, r'href="(https://www\.ithome\.com/\d+/\d+/\d+\.htm)"[^>]*>([^<]{6,90})<',
                      min_title=8)


def s_36kr():
    d = http_post_json('https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot',
                       {'partner_id': 'wap', 'param': {'siteId': 1, 'platformId': 2},
                        'timestamp': int(time.time() * 1000)},
                       headers={'Referer': 'https://36kr.com/'})
    items = []
    for grp in pick(pick(d, 'data', default={}), 'hotRankList', default=[]):
        tpl = pick(grp, 'templateMaterial', default={})
        iid = pick(tpl, 'itemId', 'item_id')
        items.append(mk(pick(tpl, 'widgetTitle', 'title'),
                        f'https://36kr.com/p/{iid}' if iid else '',
                        pick(tpl, 'statRead', 'readCount', default=0)))
    return items


def s_juejin():
    d = http_json('https://api.juejin.cn/content_api/v1/content/article_rank'
                  '?category_id=1&type=hot&spider=0',
                  headers={'Referer': 'https://juejin.cn/'})
    items = []
    for it in pick(d, 'data', default=[]):
        c, cnt = pick(it, 'content', default={}), pick(it, 'content_counter', default={})
        cid = pick(c, 'content_id')
        items.append(mk(pick(c, 'title'), f'https://juejin.cn/post/{cid}' if cid else '',
                        pick(cnt, 'view', 'hot_rank', default=0)))
    return items


def s_sspai():
    d = http_json('https://sspai.com/api/v1/article/tag/page/get'
                  '?limit=25&offset=0&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0',
                  headers={'Referer': 'https://sspai.com/'})
    rows = d if isinstance(d, list) else pick(d, 'data', default=[])
    return [mk(pick(it, 'title'), 'https://sspai.com/post/' + str(pick(it, 'id')),
               pick(it, 'like_count', 'comment_count', default=0))
            for it in rows]


def s_thepaper():
    d = http_json('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar',
                  headers={'Referer': 'https://www.thepaper.cn/'})
    data = pick(d, 'data', default={})
    rows = list(pick(data, 'hotNews', default=[])) + list(pick(data, 'editorHandpicked', default=[]))
    items = []
    for it in rows:
        cid = pick(it, 'contId')
        items.append(mk(pick(it, 'name', 'title'),
                        f'https://www.thepaper.cn/newsDetail_forward_{cid}' if cid else '',
                        pick(it, 'interactionNum', 'praiseTimes', default=0),
                        pick(it, 'summary', 'nodeInfo')))
    return items


def s_netease():
    d = http_json('https://m.163.com/fe/api/hot/news/flow',
                  headers={'Referer': 'https://m.163.com/news/'})
    return [mk(pick(it, 'title'), pick(it, 'url'), pick(it, 'commentCount', default=0))
            for it in pick(pick(d, 'data', default={}), 'list', default=[])]


def s_qq_news():
    d = http_json('https://i.news.qq.com/gw/event/hot_ranking_list'
                  '?ids_hash=&offset=0&page_size=50&rank_id=',
                  headers={'Referer': 'https://news.qq.com/'})
    items = []
    for lst in pick(d, 'idlist', 'data', default=[]):
        if not isinstance(lst, dict):
            continue
        for it in pick(lst, 'newslist', default=[]):
            if not isinstance(it, dict) or str(it.get('articletype')) == '560':
                continue
            items.append(mk(pick(it, 'title', 'longtitle'),
                            pick(it, 'surl', 'url', 'short_url'),
                            pick(it, 'readCount', default=0),
                            pick(it, 'abstract')))
    return items


def s_sina_news():
    d = http_json('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=30&page=1',
                  headers={'Referer': 'https://news.sina.com.cn/'})
    return [mk(pick(it, 'title'), pick(it, 'url'), pick(it, 'comment_count', default=0))
            for it in pick(pick(d, 'result', default={}), 'data', default=[])]


def s_sina():
    d = http_json('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2510&num=30&page=1',
                  headers={'Referer': 'https://www.sina.com.cn/'})
    return [mk(pick(it, 'title'), pick(it, 'url'), pick(it, 'comment_count', default=0))
            for it in pick(pick(d, 'result', default={}), 'data', default=[])]


def s_hupu():
    html = http_get('https://bbs.hupu.com/topic-daily', headers={'Referer': 'https://bbs.hupu.com/'})
    return html_links(html, r'href="(/(\d{7,})\.html)"[^>]*>([^<]{8,90})<',
                      base='https://bbs.hupu.com', min_title=8, group_url=1, group_title=3)


def s_douban_movie():
    d = http_json('https://movie.douban.com/j/search_subjects'
                  '?type=movie&tag=%E7%83%AD%E9%97%A8&page_limit=30&page_start=0',
                  headers={'Referer': 'https://movie.douban.com/explore'})
    return [mk(pick(it, 'title'), pick(it, 'url'), 0,
               '豆瓣评分 ' + str(pick(it, 'rate', default='-')))
            for it in pick(d, 'subjects', default=[])]


def s_acfun():
    d = http_json('https://www.acfun.cn/rest/pc-direct/rank/channel'
                  '?channelId=&rankLimit=30&rankPeriod=DAY',
                  headers={'Referer': 'https://www.acfun.cn/rank/list'})
    rl = pick(d, 'rankList', default=[])
    rows = []
    if rl and isinstance(rl[0], dict) and 'rankList' in rl[0]:
        for grp in rl:
            rows.extend(pick(grp, 'rankList', default=[]))
    else:
        rows = rl
    items = []
    for it in rows:
        if not isinstance(it, dict):
            continue
        items.append(mk(pick(it, 'contentTitle', 'title'),
                        'https://www.acfun.cn/v/ac' + str(pick(it, 'contentId')),
                        pick(it, 'viewCount', default=0),
                        pick(it, 'userName')))
    return dedup(items)


def s_zhihu_daily():
    d = http_json('https://news-at.zhihu.com/api/4/news/latest',
                  headers={'User-Agent': UA_MOBILE})
    return [mk(pick(it, 'title'),
               pick(it, 'url') or ('https://daily.zhihu.com/story/' + str(pick(it, 'id'))))
            for it in pick(d, 'stories', default=[])]


def s_tieba():
    d = http_json('https://tieba.baidu.com/hottopic/browse/topicList',
                  headers={'Referer': 'https://tieba.baidu.com/'})
    bang = pick(pick(d, 'data', default={}), 'bang_topic', default={})
    items = []
    for it in pick(bang, 'topic_list', default=[]):
        items.append(mk(pick(it, 'topic_name'),
                        pick(it, 'topic_url'),
                        pick(it, 'discuss_num', default=0),
                        pick(it, 'topic_desc')))
    return items


def s_guokr():
    html = http_get('https://www.guokr.com/', headers={'Referer': 'https://www.guokr.com/'})
    return html_cards(html, r'href="(/article/\d+)"',
                      [r'class="[^"]*MaskTitle[^"]*"[^>]*>(.*?)</p>',
                       r'<h\d[^>]*>(.*?)</h\d>',
                       r'alt="([^"]{8,90})"'],
                      base='https://www.guokr.com')


def s_yystv():
    html = http_get('https://www.yystv.cn/', headers={'Referer': 'https://www.yystv.cn/'})
    out = html_cards(html, r'href="(/p/\d+)"',
                     [r'class="[^"]*doc-title[^"]*"[^>]*>(.*?)</h\d>',
                      r'<h\d[^>]*>(.*?)</h\d>',
                      r'class="[^"]*title[^"]*"[^>]*>([^<]{8,90})<'],
                     base='https://www.yystv.cn')
    if len(out) < 5:
        out += html_cards(html, r'href="(/n/\d+)"',
                          [r'class="[^"]*title[^"]*"[^>]*>([^<]{8,90})<', r'<h\d[^>]*>(.*?)</h\d>'],
                          base='https://www.yystv.cn')
    return dedup(out)


def s_ifanr():
    html = http_get('https://www.ifanr.com/', headers={'Referer': 'https://www.ifanr.com/'})
    return html_links(html, r'href="(https://www\.ifanr\.com/\d+)"[^>]*>([^<]{8,90})<', min_title=8)


def s_linuxdo():
    d = http_json('https://linux.do/top.json?period=daily', headers={'Accept': 'application/json'})
    return [mk(pick(it, 'title'),
               f"https://linux.do/t/{pick(it, 'id')}/{pick(it, 'slug')}",
               pick(it, 'posts_count', 'like_count', default=0))
            for it in pick(pick(d, 'topic_list', default={}), 'topics', default=[])]


def s_nodeseek():
    d = http_json('https://www.nodeseek.com/api/forum/top?range=daily',
                  headers={'Referer': 'https://www.nodeseek.com/', 'Accept': 'application/json'})
    rows = d if isinstance(d, list) else pick(d, 'data', default=[])
    return [mk(pick(it, 'title'), f"https://www.nodeseek.com/post-{pick(it, 'id')}-1",
               pick(it, 'comments', default=0))
            for it in rows]


def s_hellogithub():
    d = http_json('https://api.github.com/search/repositories'
                  '?q=stars:>800+pushed:>2025-01-01&sort=stars&order=desc&per_page=25',
                  headers={'Accept': 'application/vnd.github+json'})
    return [mk(pick(it, 'full_name'), pick(it, 'html_url'),
               pick(it, 'stargazers_count', default=0), pick(it, 'description'))
            for it in pick(d, 'items', default=[])]


def s_csdn():
    d = http_json('https://blog.csdn.net/phoenix/web/blog/hot-rank?page=0&pageSize=30&type=',
                  headers={'Referer': 'https://blog.csdn.net/rank/list/hot'})
    return [mk(pick(it, 'articleTitle', 'title'),
               pick(it, 'articleDetailUrl', 'url'),
               pick(it, 'hotRankScore', 'viewCount', default=0))
            for it in pick(d, 'data', default=[])]


def s_history():
    now = datetime.now(CST)
    mm = '%02d' % now.month
    d = http_json(f'https://baike.baidu.com/cms/home/eventsOnHistory/{mm}.json',
                  headers={'Referer': 'https://baike.baidu.com/calendar'})
    items = []
    for _key, days in (d or {}).items():
        if not isinstance(days, dict):
            continue
        for day, events in days.items():
            if not str(day).startswith(mm + '%02d' % now.day):
                continue
            for ev in (events if isinstance(events, list) else []):
                if not isinstance(ev, dict):
                    continue
                items.append(mk(f"{ev.get('year', '')}年 · {strip_tags(ev.get('title', ''))}",
                                ev.get('link', ''), 0, ev.get('desc', '')))
    return items


def s_nytimes():
    xml = http_get('https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
                   headers={'Accept': 'application/rss+xml, text/xml'})
    items = []
    for m in re.finditer(r'<item>(.*?)</item>', xml, re.S):
        blk = m.group(1)
        t = re.search(r'<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', blk, re.S)
        l = re.search(r'<link>(.*?)</link>', blk, re.S)
        p = re.search(r'<pubDate>(.*?)</pubDate>', blk, re.S)
        if t:
            items.append(mk(t.group(1), l.group(1) if l else '', 0, p.group(1) if p else ''))
    return items


# ----------------------------------------------------------------------------
# 源注册表
# 说明：locally_blocked=True 的源在本机（大陆网络）不可直连，但在 GitHub Actions
#       （海外出口）上可正常抓取，因此保留。
# ----------------------------------------------------------------------------
SOURCES = [
    ('baidu',          '百度',         '热搜',   'https://top.baidu.com/board?tab=realtime',  s_baidu, False),
    ('weibo',          '微博',         '热搜榜', 'https://s.weibo.com/top/summary',           s_weibo, False),
    ('douyin',         '抖音',         '热榜',   'https://www.douyin.com/',                   s_douyin, False),
    ('toutiao',        '今日头条',     '热榜',   'https://www.toutiao.com/',                  s_toutiao, False),
    ('zhihu',          '知乎',         '热榜',   'https://www.zhihu.com/hot',                 s_zhihu, False),
    ('bilibili',       '哔哩哔哩',     '排行榜', 'https://www.bilibili.com/v/popular/rank/all', s_bilibili, False),
    ('bilibili-hot',   'B站热搜',      '热搜',   'https://search.bilibili.com/all',           s_bilibili_hot, False),
    ('qq-news',        '腾讯新闻',     '热点榜', 'https://news.qq.com/',                      s_qq_news, False),
    ('sina-news',      '新浪新闻',     '热点榜', 'https://news.sina.com.cn/',                 s_sina_news, False),
    ('netease-news',   '网易新闻',     '热点榜', 'https://news.163.com/',                     s_netease, False),
    ('thepaper',       '澎湃新闻',     '热榜',   'https://www.thepaper.cn/',                  s_thepaper, False),
    ('tieba',          '百度贴吧',     '热议',   'https://tieba.baidu.com/hottopic/browse/hottopic', s_tieba, False),
    ('ithome',         'IT之家',       '热榜',   'https://www.ithome.com/list/',              s_ithome, False),
    ('csdn',           'CSDN',         '热榜',   'https://blog.csdn.net/rank/list/hot',       s_csdn, False),
    ('juejin',         '掘金',         '热榜',   'https://juejin.cn/hot/articles',            s_juejin, False),
    ('36kr',           '36氪',         '热榜',   'https://36kr.com/hot-list/catalog',         s_36kr, False),
    ('hupu',           '虎扑',         '亮了',   'https://bbs.hupu.com/topic-daily',          s_hupu, False),
    ('douban-movie',   '豆瓣电影',     '热门',   'https://movie.douban.com/explore',          s_douban_movie, False),
    ('acfun',          'AcFun',        '排行榜', 'https://www.acfun.cn/rank/list',            s_acfun, False),
    ('zhihu-daily',    '知乎日报',     '今日',   'https://daily.zhihu.com/',                  s_zhihu_daily, False),
    ('sina',           '新浪',         '热点',   'https://www.sina.com.cn/',                  s_sina, False),
    ('sspai',          '少数派',       '热门',   'https://sspai.com/',                        s_sspai, False),
    ('github',         'GitHub',       '趋势',   'https://github.com/trending',               s_github, False),
    ('hellogithub',    'HelloGitHub',  '精选',   'https://hellogithub.com/',                  s_hellogithub, False),
    ('hackernews',     'Hacker News',  '热榜',   'https://news.ycombinator.com/',             s_hackernews, False),
    ('guokr',          '果壳',         '热门',   'https://www.guokr.com/',                    s_guokr, False),
    ('yystv',          '游研社',       '热文',   'https://www.yystv.cn/',                     s_yystv, False),
    ('ifanr',          '爱范儿',       '热文',   'https://www.ifanr.com/',                    s_ifanr, False),
    ('history',        '历史上的今天', '今日',   'https://baike.baidu.com/calendar',          s_history, False),
    ('v2ex',           'V2EX',         '热议',   'https://www.v2ex.com/?tab=hot',             s_v2ex, True),
    ('linuxdo',        'LINUX DO',     '今日',   'https://linux.do/top',                      s_linuxdo, True),
    ('nodeseek',       'NodeSeek',     '今日',   'https://www.nodeseek.com/',                 s_nodeseek, True),
    ('nytimes',        '纽约时报',     '首页',   'https://www.nytimes.com/',                  s_nytimes, True),
]

MAX_ITEMS = 50


def fetch_one(entry):
    key, label, badge, link, fn, blocked = entry
    started = time.time()
    base = {'key': key, 'label': label, 'badge': badge, 'link': link,
            'icon': f'logos/{key}.png'}
    try:
        items = dedup(fn() or [])[:MAX_ITEMS]
        return dict(base, ok=bool(items), count=len(items), items=items,
                    error=None if items else '未取到数据',
                    elapsed=round(time.time() - started, 2))
    except Exception as e:  # noqa: BLE001
        return dict(base, ok=False, count=0, items=[],
                    error=f'{type(e).__name__}: {e}'[:200],
                    elapsed=round(time.time() - started, 2))


def main(argv):
    if '--list' in argv:
        for k, label, badge, _l, _f, blocked in SOURCES:
            print(f'{k:16s} {label:12s} {badge:8s} {"(仅海外网络)" if blocked else ""}')
        return 0

    wanted = [a for a in argv[1:] if not a.startswith('-')]
    entries = [s for s in SOURCES if not wanted or s[0] in wanted]
    if not entries:
        print('没有匹配的源：', wanted)
        return 1

    print(f'开始抓取 {len(entries)} 个源…')
    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(fetch_one, e) for e in entries]
        for fut in as_completed(futs):
            r = fut.result()
            results.append(r)
            print(f"  [{'OK ' if r['ok'] else 'ERR'}] {r['label']:12s} {r['count']:3d} 条 "
                  f"{r['elapsed']:6.2f}s  {r['error'] or ''}")

    order = {s[0]: i for i, s in enumerate(SOURCES)}
    results.sort(key=lambda r: order.get(r['key'], 999))

    ok_cnt = sum(1 for r in results if r['ok'])
    payload = {
        'updated': datetime.now(CST).isoformat(timespec='seconds'),
        'total': len(results), 'ok': ok_cnt,
        'sources': results,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    print(f"\n完成：{ok_cnt}/{len(results)} 源成功，写入 {OUT_PATH} "
          f"({os.path.getsize(OUT_PATH)/1024:.1f} KB)")
    failed = [r for r in results if not r['ok']]
    if failed:
        print('失败源：' + ', '.join(f"{r['key']}({r['error']})" for r in failed))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
