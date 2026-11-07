#!/bin/bash
# 打包电脑版并上传 Steam（SteamPipe）：Windows、Linux 各一个仓库（depot）；macOS 版在 GitHub Actions 的 macOS 机器上打（见 docs/release.md）
# 用法：STEAM_APPID=应用号 STEAM_DEPOT_WIN=Windows仓库号 STEAM_DEPOT_LINUX=Linux仓库号 [STEAM_USER=Steam账号] bash tools/steam_upload.sh ["版本说明"]
#   不设 STEAM_USER：只打包，生成 steam/content/（游戏文件）与 steam/app_build.vdf（上传配置），可以拿去用 Steamworks SDK 的 SteamPipe GUI 上传
#   设了 STEAM_USER：再用 steamcmd 上传（要先装好 steamcmd；第一次登录会要 Steam 令牌验证码）
#   上传后在 Steamworks 后台「SteamPipe → 版本」里把这次构建设为默认分支（或测试分支）才会推给玩家
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
: "${STEAM_APPID:?先在 Steamworks 后台建好应用，把 App ID 填进 STEAM_APPID}"
: "${STEAM_DEPOT_WIN:?把 Windows 仓库（depot）号填进 STEAM_DEPOT_WIN，通常是 App ID + 1}"
cd "$root/desktop"
[ -d node_modules ] || npm ci
npm run dist:win
npx electron-builder --linux --x64   # 网页已由上一步 prep 生成
rm -rf "$root/steam/content" "$root/steam/output"
mkdir -p "$root/steam/content" "$root/steam/output"
cp -r dist/win-unpacked "$root/steam/content/windows"
cp -r dist/linux-unpacked "$root/steam/content/linux"
ver=$(node -p "require('./package.json').version")-$(git -C "$root" rev-parse --short HEAD)
depot() {   # 一个仓库：把 content/<目录> 下的全部文件映射到安装目录根
  printf '\t\t"%s"\n\t\t{\n\t\t\t"FileMapping"\n\t\t\t{\n\t\t\t\t"LocalPath" "%s/*"\n\t\t\t\t"DepotPath" "."\n\t\t\t\t"recursive" "1"\n\t\t\t}\n\t\t}\n' "$1" "$2"
}
{
  printf '"AppBuild"\n{\n\t"AppID" "%s"\n\t"Desc" "%s"\n\t"ContentRoot" "%s"\n\t"BuildOutput" "%s"\n\t"Depots"\n\t{\n' \
    "$STEAM_APPID" "${1:-暗剑 $ver}" "$root/steam/content/" "$root/steam/output/"
  depot "$STEAM_DEPOT_WIN" windows
  [ -n "$STEAM_DEPOT_LINUX" ] && depot "$STEAM_DEPOT_LINUX" linux
  printf '\t}\n}\n'
} > "$root/steam/app_build.vdf"
echo "已生成 steam/content/ 与 steam/app_build.vdf（$ver）"
if [ -n "$STEAM_USER" ]; then
  steamcmd +login "$STEAM_USER" +run_app_build "$root/steam/app_build.vdf" +quit
  echo '已上传：到 Steamworks 后台 SteamPipe → 版本，把这次构建设为分支上线'
fi
