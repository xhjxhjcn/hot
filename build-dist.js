#!/usr/bin/env node
/**
 * 构建脚本：把纯静态站点原样复制到 dist/
 *
 * 存在的意义只有一个 —— 让阿里云 ESA「函数和 Pages」的构建流程能跑通。
 *
 * ESA 没有「零构建」自动识别：控制台/模板默认套 `npm install` + `npm run build`
 * + 输出 `./dist`。空字符串的 buildCommand 不会被当成「跳过」，
 * 而是回退成默认的 `npm run build`，此时没有 package.json 就会
 * `npm error ENOENT package.json` 构建失败。
 *
 * 所以这里给一个真正存在的构建脚本：无论 esa.jsonc 有没有被识别，
 * 两条路径都会产出 dist/，站点都能正常发布。
 *
 * 零依赖，只用 Node 内置模块。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// 需要发布到站点的内容（scripts/ 和 .github/ 属于仓库基建，不发布）
const FILES = [
  'favicon.ico','index.html', 'robots.txt'];
const DIRS = ['assets', 'data', 'logos'];

function main() {
  // 只清空 dist 里的内容，不删 dist 目录本身。
  // 删目录在 Windows 上会因「有进程把 dist 当工作目录」（比如本地起 http.server
  // 预览 dist）而报 EBUSY: resource busy or locked。
  fs.mkdirSync(DIST, { recursive: true });
  for (const name of fs.readdirSync(DIST)) {
    fs.rmSync(path.join(DIST, name), { recursive: true, force: true });
  }

  let count = 0;
  let bytes = 0;

  const tally = (p) => {
    count += 1;
    bytes += fs.statSync(p).size;
  };

  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) {
      console.warn(`  [skip] 缺少文件 ${f}`);
      continue;
    }
    fs.copyFileSync(src, path.join(DIST, f));
    tally(src);
    console.log(`  ${f}`);
  }

  for (const d of DIRS) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) {
      console.warn(`  [skip] 缺少目录 ${d}/`);
      continue;
    }
    fs.cpSync(src, path.join(DIST, d), { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const p = path.join(src, name);
      if (fs.statSync(p).isFile()) tally(p);
    }
    console.log(`  ${d}/ (${fs.readdirSync(src).length} 个文件)`);
  }

  console.log(
    `\n构建完成 -> dist/  ${count} 个文件, ${(bytes / 1024).toFixed(0)} KB`
  );

  // 兜底自检：index.html 必须在，否则站点会 404
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('构建失败：dist/index.html 不存在');
    process.exit(1);
  }
}

main();
