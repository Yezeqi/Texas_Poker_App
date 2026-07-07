# 朋友德州扑克

一个手机横屏优先的私人德州扑克 Web App。朋友们连到同一个 Wi-Fi 后，用手机浏览器打开房间链接就能加入同一桌。

## 本地运行

```powershell
pnpm install
pnpm start
```

如果你的系统还没有安装 Node.js 和 pnpm，可以先安装 Node.js LTS，再执行：

```powershell
corepack enable
pnpm install
pnpm start
```

启动后终端会显示两个地址：

- `http://localhost:3000`：本机打开
- `http://你的局域网IP:3000`：同 Wi-Fi 手机打开

如果手机打不开，通常需要在 Windows 防火墙里允许 Node.js 或端口 `3000` 的局域网访问。

## 已有功能

- 创建房间和加入房间码
- 手机横屏/竖屏牌桌布局，折叠屏和不能横屏的设备也可操作
- PWA 支持，可以添加到手机主屏幕
- 准备机制，所有真人玩家准备后自动发牌
- 人数不够时可以添加人机
- 本手角色标记：庄家 D、小盲 SB、大盲 BB
- 买入功能：可以向系统买入，也可以向真人玩家申请买入
- 个性化座位视角：每位玩家都会看到自己坐在下方中间
- 下注反馈：下注增加时播放筹码音效，并用语音播报下注额度
- 2-8 人座位、筹码、盲注、公共牌
- 弃牌、过牌、跟注、加注、全下
- 摊牌牌型判定和底池分配

## 开局流程

1. 创建或加入房间
2. 人数不够时点“加人机”
3. 真人玩家都点“准备”
4. 所有真人玩家准备后，系统自动发牌
5. 一手结束后，真人玩家重新点“准备”开始下一手

如果玩家筹码为 0，需要先买入，才能继续准备下一手。向玩家买入时，申请方输入金额并选择真人玩家；对方同意后，申请方筹码增加，对方筹码减少。

## 当前限制

这是朋友局 MVP，不包含真钱、账号登录、重连找回身份、复杂边池和防作弊托管。正式部署到公网前，建议补上房间密码、玩家身份恢复和服务器持久化。

## 测试

先启动服务，再运行：

```powershell
pnpm smoke
```

## 封装成手机 App

最简单的方式是 PWA：

1. 在电脑上启动服务：`pnpm start`
2. 手机和电脑连同一个 Wi-Fi
3. 手机浏览器打开终端里显示的 `http://你的局域网IP:3000`
4. iPhone 用 Safari 的“分享”按钮，选择“添加到主屏幕”
5. Android 用 Chrome 菜单，选择“安装应用”或“添加到主屏幕”

注意：完整 PWA 安装通常需要 HTTPS。本地 `http://局域网IP:3000` 适合朋友局测试；如果浏览器不显示“安装应用”，可以先用“添加到主屏幕”快捷方式。正式使用建议部署到 HTTPS 域名，或用 Cloudflare Tunnel、ngrok 这类工具临时提供 HTTPS 地址。

如果要做真正的 `.apk` 或 iOS 安装包，可以用 Capacitor 包一层原生壳。那时建议先把服务器部署到云服务器，再让 App 连接固定 HTTPS 地址。

### Android APK

项目已经接入 Capacitor，并生成了 Android 工程：

```text
android/
```

首次打包前需要安装：

- Android Studio
- Android SDK
- JDK，通常 Android Studio 会一起配置

安装完成后，重新打开 PowerShell，运行：

```powershell
.\build-android-debug.cmd
```

生成的调试 APK 会在：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

如果只是修改了网页代码，可以运行：

```powershell
.\sync-android.cmd
```

App 打开后，在“服务器地址”里填写公网游戏服务器地址，例如：

```text
https://poker.example.com
```

本地或内网穿透测试也可以填：

```text
http://你的电脑IP:3000
```

正式给朋友异地使用时，建议用 HTTPS/WSS 的公网服务器。
