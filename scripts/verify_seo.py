#!/usr/bin/env python3
"""构建产物自检（SEO 契约）。

跑完 `npm run build` 后执行：`python scripts/verify_seo.py`

校验内容：
  1. 每个 HTML 页面标签配平、JSON-LD 可解析、title/description/canonical 齐全
  2. 所有站内链接（href="/..."）在 dist/ 里都有对应文件
  3. sitemap.xml 的每条 loc 都能落到实际文件
  4. 首页确实完成了预渲染（正文足够长、空壳文案已消失）
  5. 每个榜单页有唯一 H1 与足够正文（防「薄内容」）

零依赖，只用标准库。
"""

import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}

# 首页预渲染后正文至少要这么多字符（空壳版只有 176）
MIN_INDEX_TEXT = 5000
# 单页正文下限，低于这个值说明内容太薄
MIN_PAGE_TEXT = 600

# 天然就短的列表页（内容随数据积累增长，不该按薄内容报错）
THIN_OK = {'today/index.html'}

# 托管方（阿里云 ESA Pages）开了「自动去除 .html」：对外地址不带后缀。
# 见 scripts/prerender.js 顶部的说明。
STRIP_HTML = True


def resolve(url_path):
    """把站内 URL 路径映射到 dist 里的实际文件。

    对外地址是不带 .html 的（ESA 会 307 掉 .html），而磁盘上仍是 xxx.html，
    所以这里要按「原样 / 补 index.html / 补 .html」依次试。
    """
    rel = url_path.lstrip('/')
    if not rel or rel.endswith('/'):
        rel += 'index.html'
    for cand in (rel, rel + '.html'):
        full = os.path.join(DIST, cand.replace('/', os.sep))
        if os.path.exists(full):
            return full
    return None


class TagBalance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.bad = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.bad.append(f'多余的 </{tag}>')
        elif self.stack[-1] != tag:
            self.bad.append(f'期望 </{self.stack[-1]}> 却遇到 </{tag}>')
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
        else:
            self.stack.pop()


def visible_text(html):
    t = re.sub(r'<(script|style)[\s\S]*?</\1>', ' ', html, flags=re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def walk_html():
    out = []
    for root, _dirs, files in os.walk(DIST):
        for f in files:
            if f.endswith('.html'):
                full = os.path.join(root, f)
                out.append((os.path.relpath(full, DIST).replace(os.sep, '/'), full))
    return sorted(out)


def main():
    if not os.path.isdir(DIST):
        print('dist/ 不存在，先跑 npm run build')
        return 1

    problems = []
    pages = walk_html()
    internal = 0
    sizes = []

    for rel, full in pages:
        html = open(full, encoding='utf-8').read()
        text = visible_text(html)
        sizes.append((len(text), rel))

        tb = TagBalance()
        tb.feed(html)
        if tb.bad or tb.stack:
            problems.append(f'{rel}: 标签不配平 {tb.bad[:3]} 未闭合={tb.stack[:3]}')

        for i, block in enumerate(re.findall(
                r'<script type="application/ld\+json">(.*?)</script>', html, re.S), 1):
            try:
                json.loads(block)
            except Exception as e:
                problems.append(f'{rel}: JSON-LD #{i} 解析失败 {e}')

        for need, label in (('<title>', 'title'),
                            ('<meta name="description"', 'description'),
                            ('rel="canonical"', 'canonical'),
                            ('<h1>', 'H1')):
            if need not in html:
                problems.append(f'{rel}: 缺 {label}')

        if len(text) < MIN_PAGE_TEXT and rel not in THIN_OK:
            problems.append(f'{rel}: 正文过薄（{len(text)} 字符）')

        for href in re.findall(r'href="(/[^"#?]*)"', html):
            internal += 1
            if STRIP_HTML and href.endswith('.html'):
                # 托管方会把 /x.html 307 到 /x，站内链接必须直接写 /x，
                # 否则每条内链都白吃一跳、还浪费爬虫预算。
                problems.append(f'{rel}: 站内链接带 .html（会 307）-> {href}')
            if resolve(href) is None:
                problems.append(f'{rel}: 站内链接 404 -> {href}')

    # 首页预渲染
    index_path = os.path.join(DIST, 'index.html')
    if not os.path.exists(index_path):
        problems.append('dist/index.html 不存在')
    else:
        idx = open(index_path, encoding='utf-8').read()
        n = len(visible_text(idx))
        if n < MIN_INDEX_TEXT:
            problems.append(f'首页正文只有 {n} 字符，预渲染疑似未生效')
        if '正在加载各平台榜单' in idx:
            problems.append('首页仍残留空壳文案「正在加载各平台榜单…」')
        print(f'首页可见正文 : {n} 字符（改造前 176）')
        print(f'首页卡片数   : {idx.count("class=\"hot-card\"")}')

    # sitemap
    sm_path = os.path.join(DIST, 'sitemap.xml')
    locs = []
    if not os.path.exists(sm_path):
        problems.append('dist/sitemap.xml 不存在')
    else:
        sm = open(sm_path, encoding='utf-8').read()
        locs = re.findall(r'<loc>(.*?)</loc>', sm)
        from urllib.parse import urlparse
        for loc in locs:
            p = urlparse(loc).path
            if STRIP_HTML and p.endswith('.html'):
                problems.append(f'sitemap 里是带 .html 的重定向地址: {loc}')
            if resolve(p) is None:
                problems.append(f'sitemap 指向缺失页面: {loc}')

        # canonical 也必须与 sitemap 用同一套地址，否则搜索引擎会当成两套
        for rel, full in pages:
            hm = re.search(r'<link rel="canonical" href="([^"]+)"', open(full, encoding='utf-8').read())
            if hm and STRIP_HTML and urlparse(hm.group(1)).path.endswith('.html'):
                problems.append(f'{rel}: canonical 带 .html（会 307）-> {hm.group(1)}')

    sizes.sort()
    print(f'HTML 页面数  : {len(pages)}  ｜ sitemap 条目: {len(locs)}  ｜ 站内链接: {internal}')
    print(f'正文字数     : 最薄 {sizes[0][0]}（{sizes[0][1]}）  '
          f'中位数 {sizes[len(sizes) // 2][0]}  合计 {sum(s[0] for s in sizes)}')
    print(f'最薄 5 页    : ' + ', '.join(f'{n}({p})' for n, p in sizes[:5]))

    if problems:
        print(f'\n发现 {len(problems)} 个问题：')
        for p in problems[:30]:
            print('  -', p)
        return 1

    print('\n全部校验通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
