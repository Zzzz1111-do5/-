# 蓝星纪元 Android 版

一个只有一个 Activity 的 WebView 外壳：把离线版网页打包进 APK 的 `assets/index.html`，全屏运行。

- 完全离线，**不申请任何权限**（连网络权限都没有），没有 JS 桥接对象。
- 包名 `com.blueplanet.jiyuan`，minSdk 21（Android 5.0）/ targetSdk 34，版本 4.1（versionCode 1）。
- 沉浸式全屏，旋转屏幕不会重建页面，前台时保持亮屏。
- 页面里的 http(s) 链接交给系统浏览器打开；WebView 渲染进程崩溃时自动重建而不是闪退。
- 切到后台时调用页面的 `window.__appPause()`（立即存档并暂停），回到前台调用 `window.__appResume()`。
- 返回键先调用 `window.__appBack()` 关闭最上层的弹窗/面板；什么都没开时，2 秒内再按一次退出。

## 构建

不用 Gradle，也不需要 AndroidX，只要：

- JDK 11 或更新版本（`javac`、`keytool` 在 PATH 中）、`zip`
- Android SDK：`platforms;android-34` 和 `build-tools;34.0.0`
  （SDK 位置取 `ANDROID_HOME`，未设置时用 `/root/android-sdk`）

```sh
# 安装 SDK 组件（commandlinetools 从 dl.google.com 下载后）
yes | sdkmanager --sdk_root=/root/android-sdk "platforms;android-34" "build-tools;34.0.0"

# 打包：默认使用 dist/blue-planet-offline.html，不存在时退回 index.html
android/build.sh                      # 输出 dist/blue-planet.apk
android/build.sh 某个页面.html 输出.apk
BP_DEBUG=1 android/build.sh           # 可调试版本，可用 chrome://inspect 调试 WebView
```

流程：`aapt2 compile/link` → `javac -source 8 -target 8` → `d8` → 加入 `classes.dex` → `zipalign` → `apksigner`。
中间文件都在 `android/build/`（已加入 .gitignore），每次构建会清空重来。

注意：build-tools 34 自带的 d8 遇到 JDK 21 编译出的匿名类/内部类或泛型桥接方法会崩溃，
所以 `MainActivity` 里只用带显式构造函数的静态嵌套类。确实需要时可以用 `D8=<更新的 d8>` 指定别的 d8。

图标由 `python3 android/make_icons.py`（需要 Pillow）生成到 `res/mipmap-*`，生成结果已提交，平时不用重跑。

## 签名

`keystore/blue-planet.jks` 是**故意提交到仓库**的签名文件（别名 `blueplanet`，RSA 2048，有效期 30 年，
密码 `blueplanet2026`）。这样以后任何人重新构建出的 APK 都能直接覆盖安装旧版本，玩家的存档不会因为
"签名不一致必须先卸载" 而丢失。`build.sh` 只会复用它，只有文件不存在时才会生成新的。

这只是一个业余项目用的公开密钥，任何人都能用它签出"看起来是同一个应用"的 APK。如果要正式发布
（应用商店、对外分发），请换成自己保管的私钥：

```sh
keytool -genkeypair -keystore ~/my-release.jks -storetype PKCS12 -alias mykey \
  -keyalg RSA -keysize 2048 -validity 10958
BP_KEYSTORE=~/my-release.jks BP_KEY_ALIAS=mykey BP_STORE_PASS=... BP_KEY_PASS=... android/build.sh
```

换了密钥之后，用旧密钥签名的已安装版本需要先卸载才能安装新版本（卸载会清掉 WebView 里的存档）。
