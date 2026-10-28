# 上架清单：Steam（电脑版）与 TapTap（安卓版）

暗剑有三个发布形态，都从同一份网页代码生成（`tools/build_www.mjs`）：

| 版本 | 外壳 | 打包 | 发到哪 |
|---|---|---|---|
| 网页版 | 浏览器 | `bash tools/publish_pages.sh` | GitHub Pages（试玩、隐私政策网址） |
| 电脑版 | Electron（`desktop/`） | `cd desktop && npm ci && npm run dist:win` | Steam |
| 安卓版 | Capacitor（`android/`） | `npm run sync` 后用 Android Studio 或 gradlew | TapTap |

商店版（电脑、安卓）和网页版的区别：不显示右上角版本号、不检查更新；菜单里有「退出游戏」；电脑版设置里有「全屏」（F11、Alt+Enter）；安卓版第一次打开要同意《用户协议》《隐私政策》，开始界面有健康游戏忠告，返回键当 Esc 用。两份协议在 `legal/`，各版本的「设置」底部都能打开。

## 一、打包

### 用 GitHub Actions（推荐，不用自己装环境）

1. 改版本号（见「每次更新」），提交推送。
2. 打标签并推送：`git tag v1.0.0 && git push origin v1.0.0`。
3. 打开仓库的 Actions 页面 →「打包发布版」这次运行 → 页面底部 Artifacts 下载：
   - `Darksword-windows-x64`：Windows 版整个文件夹（传 Steam）
   - `Darksword-linux-x64`：Linux 版（tar.gz，传 Steam 的 Linux 仓库，可选）
   - `Darksword-mac-universal`：macOS 版（可选）
   - `Darksword-android`：APK / AAB（设了签名密钥才是可以上架的正式包，否则是调试包）
4. 安卓正式签名：仓库 Settings → Secrets and variables → Actions，添加四个：
   - `ANDROID_KEYSTORE_BASE64`：签名文件转 base64（`base64 -w0 darksword-release.jks`）
   - `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`

改了 `desktop/`、`android/` 或打包脚本时，推送到任何分支也会自动跑一次，检查打包没坏。

### 在自己电脑上

- 电脑版：装 Node.js 22，`cd desktop && npm ci && npm start` 直接试玩；`npm run dist:win` 打 Windows 包（输出 `desktop/dist/win-unpacked/`）。
- 安卓版：装 Android Studio，`npm ci && npm run sync && npm run open`，在 Android Studio 里 Build → Generate Signed Bundle / APK。
- 签名文件只生成一次（命令见 `android/keystore.properties.example`），**文件和密码一定要备份**：丢了就没法给已经安装的玩家推更新。

## 二、Steam

官方流程：[Steam Direct](https://partner.steamgames.com/steamdirect)、[发行流程](https://partner.steamgames.com/doc/store/releasing)、[商店素材规格](https://partner.steamgames.com/doc/store/assets)、[库素材规格](https://partner.steamgames.com/doc/store/assets/libraryassets)。

1. **注册 Steamworks**（partner.steamgames.com）：签数字协议，填银行、税务信息，做身份验证（约 15–30 天）；每个游戏付 100 美元上架费（游戏收入满 1000 美元后返还）。**从付费到能发售至少等 30 天。**
2. **建应用**：得到 App ID；默认带一个 Windows 仓库（depot，号码通常是 App ID + 1）。要发 Linux 版就再加一个 Linux 仓库。
3. **安装设置 → 启动选项**：
   - Windows：可执行文件 `Darksword.exe`
   - Linux：可执行文件 `darksword`，参数 `--no-sandbox`（Steam 的 Linux 运行环境里 Chromium 自带的沙箱起不来）
4. **上传游戏**（二选一）：
   - Steamworks SDK 里的 SteamPipe 图形工具（ContentBuilder）：把下载的 `Darksword-windows-x64` 文件夹作为 Windows 仓库的内容上传；
   - 命令行：`STEAM_APPID=… STEAM_DEPOT_WIN=… STEAM_DEPOT_LINUX=… STEAM_USER=你的账号 bash tools/steam_upload.sh`（要先装 steamcmd）。
   上传后到「SteamPipe → 版本」把这次构建设到 default 分支。
5. **商店页**：图片在 `store/`，按文件名对应上传：
   - `store/steam/header_capsule.jpg`（920×430）、`small_capsule.jpg`（462×174）、`main_capsule.jpg`（1232×706）、`vertical_capsule.jpg`（748×896）
   - 库：`library_capsule.jpg`（600×900）、`library_header.jpg`（920×430）、`library_hero.jpg`（3840×1240，不带字）、`library_logo.png`（1280×720 透明底）
   - `page_background.jpg`（1438×810，可选）
   - 截图：`store/screens/` 里的 7 张（1920×1080，至少传 5 张）
   - 社区图标 `community_icon_184.jpg`、客户端图标 `client_icon.ico` / `client_icon_32.tga`
   - 文案、标签、配置要求、语言：`docs/store.md`（**支持语言只勾简体中文**）
   - 预告片（可选）：`node tools/store_assets.js` 会生成一段 30 秒的实机视频（无声），更好的是自己用 OBS 录一段带声音的
6. **提审**：商店页填完点「标记为准备好审核」（一般 3–5 个工作日，至少提前 7 天交）；商店页通过后再提交构建审核。
7. **「即将推出」页面要公开至少两周**才能发售。这段时间可以收集愿望单。
8. **发售前自测**：用 Steam 客户端安装、启动；Shift+Tab 能打开 Steam 界面；全屏切换、退出游戏正常；断网也能玩。
9. 价格在 Steamworks 的「定价」里设。

## 三、TapTap

官方流程：[开发者快速入门](https://developer.taptap.cn/docs/en/store/standardies-operation/)、[游戏审核规范](https://developer.taptap.cn/docs/en/store/release/publish/agree/)、[素材规格](https://developer.taptap.cn/docs/en/store/release/publish/material/)、[TapPlay 上架](https://developer.taptap.cn/docs/en/sdk/tap-play/input/)、[实名认证与防沉迷](https://developer.taptap.cn/docs/en/sdk/anti-addiction/features/)。

1. **资质**：暗剑是单机、不联网、没有内购，按 TapTap 的规则走「开放试玩」，需要 **防沉迷 + 隐私合规**；**不需要版号**（收费下载或加内购才要版号和软著）；不联网所以不涉及 ICP 备案。
2. **注册** TapTap 开发者服务中心（developer.taptap.cn），完成开发者认证。
3. **防沉迷**（二选一）：
   - **TapPlay 上架（推荐）**：由 TapTap 的运行环境负责登录、实名认证和防沉迷，游戏不用接 SDK；要求上传 32 / 64 位都兼容的 APK——暗剑没有原生库，APK 天然兼容。**文档没写 WebView 打包的游戏能不能走 TapPlay，提交前在开发者后台发工单问一下。**
   - 接入 TapTap 防沉迷 SDK：要做原生安卓插件和 TapTap 登录，工作量大，等确定需要再做。
4. **隐私合规**：
   - 先把 `legal/privacy.html`、`legal/terms.html` 里的「《暗剑》开发者」和联系方式换成你在 TapTap 认证的主体名称（个人姓名或公司名）和邮箱；改完把 `js/platform.js` 的 `PLAT_LEGAL_V` 加一。
   - 发布网页版：`bash tools/publish_pages.sh`，隐私政策网址就是 `https://zzzz1111-do5.github.io/-/legal/privacy.html`，填进后台。
   - 游戏里已经做了：第一次打开先弹协议、同意后才进游戏，不同意可以退出；「设置」底部随时能看两份协议；不收集任何个人信息、不联网。
5. **适龄提示**：建议填 12+。
6. **上传 APK**：用正式签名的 release 包（GitHub Actions 设好签名密钥后产出，或 Android Studio 打）。
7. **素材**（`store/taptap/`、`store/screens/`）：
   - 图标：`icon_512.png`（方形、不带圆角、墨绿底；TapTap 不收纯黑 / 白 / 透明底）
   - 截图：`store/screens/` 挑 3 张以上（横屏 1920×1080，每张不到 1 MB）
   - 16:9 宣传图：`promo_1920x1080.jpg`；其他可选：`cover_460x215.jpg`、`cover_600x900.jpg`、`logo_1280.png`、`wallpaper_3840x1240.jpg`、`featured_1920x1280.jpg`、`nologo_1920x1080.jpg`、`nologo_720x1080.jpg`
   - **实机录像（上架必填）**：15 秒以上的 MP4；`node tools/store_assets.js` 生成的 `video/gameplay_1080p.mp4` 可以用，也可以自己用手机录屏
   - 文案：`docs/store.md`
8. **审核**：素材和资质审核一般 5–7 天。

## 四、每次更新

1. 改版本号（三处保持一致）：
   - `package.json` 的 `version`（安卓、网页显示的版本号）
   - `desktop/package.json` 的 `version`（电脑版）
   - `android/app/build.gradle` 的 `versionName`，**`versionCode` 加一**（商店不收相同或更小的）
2. 提交、推送、打标签（`git tag v1.0.1 && git push origin v1.0.1`），等 Actions 打完包。
3. Steam：上传新构建、设到 default 分支；TapTap：后台上传新 APK、写更新日志。
4. 协议有实质改动时把 `js/platform.js` 的 `PLAT_LEGAL_V` 加一，玩家下次打开会重新确认。

## 五、还没做、以后可以做

- 英文界面（现在只有简体中文，海外玩家看不懂）。
- Steam 成就、云存档（存档现在在本机：Windows 是 `%APPDATA%\Darksword`）。
- 手柄操作（Steam Deck「已验证」需要）。
- macOS 正式签名与公证（现在是临时签名：从 Steam 下载能运行，直接下载的话第一次要在「系统设置 → 隐私与安全性」里允许）。
- TapTap 防沉迷 SDK、TapTap 登录（不走 TapPlay 时需要）。
