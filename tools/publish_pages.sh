#!/bin/bash
# 发布独立网站（GitHub Pages，不依赖 Claude）：先生成完整网页 www/（tools/build_www.mjs：补上 doctype、字符集、手机视口），
# 再把 www/ 同步到 gh-pages 分支并推送；GitHub 自动部署到 https://<用户名>.github.io/<仓库名>/
# 用法：bash tools/publish_pages.sh ["提交说明"]
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
node "$root/tools/build_www.mjs"
tmp=$(mktemp -d)
trap 'git -C "$root" worktree remove --force "$tmp" >/dev/null 2>&1 || true' EXIT
if git -C "$root" fetch -q origin gh-pages 2>/dev/null; then
  git -C "$root" worktree add -q --detach "$tmp" FETCH_HEAD
  git -C "$tmp" checkout -q -B gh-pages
else   # 第一次发布：建一个只放网页文件的空分支
  git -C "$root" worktree add -q --detach "$tmp"
  git -C "$tmp" checkout -q --orphan gh-pages
fi
find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$root/www/." "$tmp/"
touch "$tmp/.nojekyll"   # 原样发布，不经 Jekyll 处理
printf '# 暗剑 Darksword · 网页版\n\n本分支只放网页文件（GitHub Pages），由开发分支用 tools/publish_pages.sh 生成，不要直接改。\n' > "$tmp/README.md"
git -C "$tmp" add -A
if git -C "$tmp" diff --cached --quiet; then echo '网页版没有变化'; exit 0; fi
git -C "$tmp" commit -qm "${1:-更新网页版}"
git -C "$tmp" push -q origin gh-pages
echo '已推送 gh-pages，GitHub Pages 约 1 分钟后更新'
