# MMA-CN 完整部署说明

本文档对应当前工作目录中的 MMA-CN 版本（包含百度/腾讯街景、PSV、华为底图和街景覆盖层改动），重点说明 Android Termux + proot 的浏览器部署，也包含普通 Linux 服务器部署方式。

## 1. 部署方式与限制

项目本质上是 Tauri 桌面程序。浏览器部署不是单独的静态网页，而是由 Rust/Tauri 后端同时提供前端资源和 IPC 接口：

- `5173`：仅供 `cargo tauri dev` 使用的 Vite 开发端口，不能作为完整服务单独使用。
- `1430`：`web-serve` 模式的完整入口，浏览器应打开这个端口。
- 默认只监听 `127.0.0.1:1430`；设置 `MMA_SERVE_ADDR=0.0.0.0:1430` 后可供局域网访问。
- 即使使用浏览器模式，后台仍会建立一个隐藏的 WebKitGTK 窗口来承载 Tauri IPC，因此无图形界面的 Linux/proot 需要 `Xvfb`。
- 当前没有登录、鉴权和多人冲突处理。适合单人编辑；可以多端打开，但不应多人同时编辑同一题库，也不要把 `1430` 端口直接暴露到公网。

当前工作树包含尚未提交到 Git 的定制代码。直接重新克隆 `https://github.com/ccmdi/mma.git` 只能得到上游版本，不包含本地的百度/腾讯功能。部署当前版本时，应使用现有的 `mma-cn` 目录，或先把当前改动提交并推送到自己的仓库。

## 2. 推荐规格

最低建议：

- 架构：`arm64/aarch64` 或 `x86_64`
- 内存：4 GB；首次 Rust 编译建议 6 GB 以上或准备 swap
- 可用磁盘：10 GB 以上；`target/debug` 和 `target/release` 会占用数 GB
- Node.js：24.x（项目 `.nvmrc` 为 24，`package.json` 要求 `^24.15.0`）
- npm：Node 24 自带版本
- Rust：stable；项目声明的最低版本是 1.77.2，但建议直接使用最新 stable
- 网络：需要访问 npm、crates.io，并在运行时访问华为、百度、腾讯及腾讯覆盖数据源

不要混用 Termux/Android 与 proot/Linux 的 `node_modules`。两者需要的平台二进制不同。确定使用 proot 后，所有 `npm ci`、构建和启动命令都应在同一个 proot 发行版内执行。

## 3. Android Termux + proot 部署（推荐）

以下示例使用 Debian。Ubuntu 的操作基本相同，只需把发行版名称改成 `ubuntu`。

### 3.1 Termux 宿主环境（首次执行）

在 Termux 中执行：

```sh
pkg update
pkg upgrade
pkg install git proot-distro
proot-distro install debian
```

`proot-distro install debian` 只在首次安装发行版时执行。以后直接登录，不要重复安装。

把当前 Termux 工作目录显式挂载为 proot 内的 `/workspace`：

```sh
proot-distro login debian --bind /data/data/com.termux/files/home/tuxun:/workspace
```

以后本文中标注“proot 内”的命令，都在这个登录后的 shell 中运行。

### 3.2 Debian/Ubuntu 系统依赖（proot 内，首次执行）

```sh
apt update
apt upgrade -y
apt install -y build-essential ca-certificates curl file git iproute2 pkg-config \
  libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
  xvfb xauth tmux
```

如果发行版报告找不到 `libayatana-appindicator3-dev`，可先去掉这一项继续安装；浏览器服务模式通常不依赖托盘功能。若 `libwebkit2gtk-4.1-dev` 不存在，说明发行版过旧，应升级到当前 Debian/Ubuntu，而不是改用旧的 `4.0` 包。

### 3.3 安装 Node.js 24（proot 内，首次执行）

建议通过 nvm 固定 Node 24，避免 Termux 当前的 Node 26 与项目引擎范围不一致：

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
nvm use 24
node --version
npm --version
```

`node --version` 应显示 `v24.15.0` 或更高的 24.x。重新进入 proot 后如果找不到 `node`，重新执行上面的 `NVM_DIR` 和加载 `nvm.sh` 两行，或确认 nvm 已将它们写入 `~/.bashrc`。

### 3.4 安装 Rust（proot 内，首次执行）

不要使用发行版中可能过旧的 `rustc`：

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
rustup default stable
rustc --version
cargo --version
```

### 3.5 安装前端依赖（proot 内，首次或锁文件变化后执行）

```sh
cd /workspace/mma-cn/app
nvm use 24
npm ci
```

使用 `npm ci` 可以严格按照 `package-lock.json` 安装。它会清理并重建 `node_modules`，所以不要在有未保存的手工依赖修改时执行。

### 3.6 编译当前版本（proot 内）

生产部署推荐 release 构建：

```sh
cd /workspace/mma-cn/app
nvm use 24
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

生成的服务程序位于：

```text
/workspace/mma-cn/app/src-tauri/target/release/map-making-app
```

首次 Rust 编译可能需要 10～30 分钟，proot/手机上也可能更久。只要仍有 CPU 活动且没有 error，停留在 `Building ... 808/810` 一段时间属于正常现象。

为了快速验证，也可以构建 debug 版本：

```sh
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve
```

对应程序是 `src-tauri/target/debug/map-making-app`。debug 文件更大、运行稍慢，但增量编译通常更快。

### 3.7 启动服务（proot 内，每次使用时执行）

仅供本机浏览器访问：

```sh
cd /workspace/mma-cn/app
MMA_SERVE_ADDR=127.0.0.1:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

局域网其他设备也要访问时：

```sh
cd /workspace/mma-cn/app
MMA_SERVE_ADDR=0.0.0.0:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

看到下面一类输出后即已启动：

```text
[webserve] http://127.0.0.1:1430
```

本机打开 `http://127.0.0.1:1430/`。局域网设备打开 `http://手机的局域网IP:1430/`。proot 与 Android 共用网络，无需寻找单独的 proot IP。

如果只编译了 debug 版本，将命令中的 `target/release` 改成 `target/debug`。

`xvfb-run -a` 会创建临时虚拟显示器，让 GTK/WebKit 可以初始化；它不会把应用窗口显示出来。缺少这一层时会出现 `Failed to initialize GTK`。

### 3.8 让服务在退出 shell 后继续运行

proot 通常没有 systemd，推荐使用 tmux：

```sh
tmux new -s mma
cd /workspace/mma-cn/app
MMA_SERVE_ADDR=0.0.0.0:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

按 `Ctrl+B`，再按 `D`，可从会话分离。重新登录 proot 后恢复：

```sh
tmux attach -t mma
```

停止服务时在该 tmux 窗口按 `Ctrl+C`。Android 仍可能因省电策略杀死 Termux；长期运行时需允许 Termux 后台运行并关闭对它的电池优化。手机重启后需要重新登录 proot 并启动服务。

## 4. 普通 Debian/Ubuntu Linux 服务器部署

普通 Linux 的编译环境与 3.2～3.6 相同，不需要 proot。将源码放在合适目录后，在 `mma-cn/app` 内执行 `npm ci`、`npm run build` 和 release `cargo build`。

### 4.1 安装为 systemd 服务

先创建专用用户和安装目录：

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin mma
sudo install -d -o mma -g mma /opt/mma
sudo install -m 0755 src-tauri/target/release/map-making-app /opt/mma/map-making-app
```

创建 `/etc/systemd/system/mma.service`：

```ini
[Unit]
Description=MMA-CN browser service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mma
Group=mma
Environment=MMA_SERVE_ADDR=127.0.0.1:1430
Environment=XDG_DATA_HOME=/var/lib/mma
Environment=XDG_CONFIG_HOME=/var/lib/mma/config
Environment=XDG_CACHE_HOME=/var/cache/mma
Environment=XDG_RUNTIME_DIR=/run/mma
StateDirectory=mma
CacheDirectory=mma
RuntimeDirectory=mma
ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1280x720x24" /opt/mma/map-making-app --serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

加载并启动：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now mma
sudo systemctl status mma
sudo journalctl -u mma -f
```

应用数据通常会落在 `/var/lib/mma/app.map-making.local/`，配置指针位于 `/var/lib/mma/config/app.map-making.local/`。以程序设置页显示的数据目录为最终依据。

### 4.2 更新 systemd 部署

在构建目录完成新的前端和 Rust release 构建后：

```sh
sudo systemctl stop mma
sudo install -m 0755 src-tauri/target/release/map-making-app /opt/mma/map-making-app
sudo systemctl start mma
sudo systemctl status mma
```

更新程序前应先备份数据目录。

## 5. 编译期地图配置

以下变量由 Vite 在 `npm run build` 时写入前端包，改变后必须重新执行前端构建和 Rust 构建：

```sh
export VITE_PETAL_MAP_KEY='你的华为 Petal Maps key'
export VITE_PETAL_TILE_URL='可选：完整的自定义瓦片 URL 模板'
export VITE_TENCENT_COVERAGE_URL='可选：腾讯覆盖 PMTiles URL'
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

注意：

- 源码不内置华为底图 key，必须设置 `VITE_PETAL_MAP_KEY` 才能加载华为底图；请使用自己有授权、配额和域名配置的 key。
- `VITE_PETAL_TILE_URL` 优先于 `VITE_PETAL_MAP_KEY`。
- 腾讯覆盖层会尝试把 `https://qq-map.netlify.app/lines.pmtiles` 缓存到服务端数据目录下的 `cache/tencent-lines.pmtiles`。当前 Rust 缓存下载地址是固定的；仅改变前端 `VITE_TENCENT_COVERAGE_URL` 只会改变远程回退地址，不会同步改变 Rust 缓存源。
- 百度和腾讯街景元数据及瓦片均在运行时访问真实服务，不需要额外的本地 API 服务。

运行时网络至少需要允许访问：

- `maprastertile-drcn.dbankcdn.cn`
- `mapsv0.bdimg.com`、`mapsv1.bdimg.com`
- `sv.map.qq.com`、`sv1.map.qq.com`～`sv4.map.qq.com`
- `qq-map.netlify.app`

## 6. 验证部署与导入测试题库

服务启动后，另开一个终端检查：

```sh
curl -fsS http://127.0.0.1:1430/ -o /dev/null
```

命令无输出且退出码为 0，说明 HTTP 入口可访问。也可检查监听：

```sh
ss -ltn | grep 1430
```

浏览器验证顺序：

1. 打开 `http://127.0.0.1:1430/`，确认能看到完整编辑器，而不是空白页。
2. 使用界面中的 JSON 导入/文件上传，选择 `/workspace/maps/export(2).json`。从手机浏览器上传时，选择 Termux 中原文件对应的可访问副本；浏览器不能直接读取 proot 内部路径。
3. 文件当前内部名称为 `小蓝点测试2`，内容是百度街景点位；可在导入后按需要改名为“西藏小蓝点”。
4. 打开任一位置，确认华为底图、百度街景低清到高清瓦片和点位标记正常。
5. 再测试一个腾讯普通街景和 Trekker 点位，确认 PSV 能显示瓦片。
6. 打开百度/腾讯覆盖层，首次启用腾讯覆盖时等待 PMTiles 后台缓存完成。

数据导入发生在运行服务的设备上，而不是访问网页的客户端上。换浏览器不会产生一套新的题库数据。

## 7. 日常启动与何时需要重新编译

日常启动不需要重新编译，直接执行已生成的 `map-making-app --serve` 即可。

| 变化 | `npm ci` | `npm run build` | `cargo build ... --release` |
| --- | --- | --- | --- |
| 仅重启服务 | 不需要 | 不需要 | 不需要 |
| 修改 React/TS/CSS/静态资源 | 通常不需要 | 需要 | 需要 |
| 修改 `VITE_*` 配置 | 不需要 | 需要 | 需要 |
| 修改 Rust 代码 | 不需要 | 通常不需要 | 需要 |
| `package-lock.json` 改变 | 需要 | 需要 | 需要 |
| `Cargo.lock`/Rust 依赖改变 | 不需要 | 通常不需要 | 需要 |

前端 `dist` 会被嵌入 Tauri 二进制，因此只执行 `npm run build` 而不重新构建 Rust，正在运行的二进制仍会提供旧前端。

`cargo run --features web-serve -- --serve` 每次都会先检查是否需要编译。没有源码变化时不会完整重编，但生产环境仍建议直接运行 `target/release/map-making-app`，启动更快、行为更可控。

## 8. 数据、备份与恢复

应用数据保存在运行 Rust 服务的 Linux/proot 环境中，主要包括：

- `mma.db`：地图元数据和应用状态
- `arrow/`：点位快照、增量和提交历史
- `plugins/`：用户插件（如有）
- `cache/tencent-lines.pmtiles`：可重新下载的腾讯覆盖缓存

桌面/proot 用户的默认目录通常是：

```text
~/.local/share/app.map-making.local/
```

如果在设置中改过数据目录，应以设置页显示路径为准；配置指针通常在：

```text
~/.config/app.map-making.local/data_location.txt
```

备份前先停止服务，避免同时写入数据库和 Arrow 文件。完整复制实际数据目录即可。腾讯覆盖缓存可以不备份，之后会重新下载。恢复时保持服务停止，将备份放回原路径并确认运行用户拥有读写权限，再启动服务。

## 9. 局域网和公网安全

### 9.1 局域网

仅在可信局域网中使用 `MMA_SERVE_ADDR=0.0.0.0:1430`。确认路由器没有把 1430 做公网端口转发。多人可以同时打开页面，但当前后端只有一份全局活动地图和编辑状态，多人编辑会互相干扰。

### 9.2 公网

当前 web-serve IPC 没有认证，并能执行导入、导出和数据修改等操作，禁止直接把 1430 暴露到公网。如果确实需要远程访问，至少应满足：

- 后端继续只监听 `127.0.0.1:1430`
- 前面使用 Caddy/Nginx 提供 HTTPS
- 在反向代理层启用强密码或可信身份认证
- 仅授权单个编辑者，或先实现只读访问/用户系统
- 对 SSE 路由关闭代理缓冲，并适当增加上传大小和读取超时

Nginx 反向代理核心配置示例（认证文件需自行创建）：

```nginx
location / {
    auth_basic "MMA";
    auth_basic_user_file /etc/nginx/mma.htpasswd;
    client_max_body_size 200m;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_pass http://127.0.0.1:1430;
}
```

这只是外围保护，不会让应用获得真正的多人权限隔离或冲突合并能力。

## 10. 常见问题

### 打开 `http://127.0.0.1:5173/` 是空白页

不要单独用 `npm run dev` 作为部署服务。停止它并启动带 `--features web-serve` 构建出的 Rust 程序，然后打开 `http://127.0.0.1:1430/`。

### `Failed to initialize GTK`

启动命令缺少可用显示器。确认已安装 `xvfb` 和 `xauth`，并使用：

```sh
xvfb-run -a ./src-tauri/target/release/map-making-app --serve
```

### `Unable to resolve @typescript/typescript-android-arm64`

这是直接在 Android/Termux 中运行 `@typescript/native` 的平台问题。当前 `plugins/types/generate.js` 已优先使用 JavaScript TypeScript 编译器，但最稳定的部署方式仍是进入 Debian/Ubuntu proot，执行一次干净的 `npm ci` 后构建。不要复用 Termux 创建的 `node_modules`。

### 构建停在最后几个 crate

Tauri/WebKit 的最终链接阶段可能长时间没有新输出，尤其是在手机和 proot 中。检查 CPU 和剩余磁盘；只要进程仍在运行且未出现 error，应继续等待。首次完成后后续增量构建会快很多。

### 端口已被占用

```sh
ss -ltnp | grep 1430
```

停止旧实例，或换端口启动：

```sh
MMA_SERVE_ADDR=127.0.0.1:1431 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

### 页面能打开但没有地图或街景

依次检查浏览器开发者工具中的网络错误、系统时间、DNS，以及第 5 节列出的域名是否可访问。华为底图需要配置自己的 key，并受其配额或授权限制；百度覆盖瓦片和街景、腾讯元数据与瓦片都依赖外部真实接口，断网时不会完整工作。

### 腾讯覆盖第一次较慢

首次启用时后端会下载 PMTiles 到数据目录。下载完成后从本地读取会更快。若缓存文件不完整，可在停止服务后仅删除 `cache/tencent-lines.pmtiles`，重新启动并再次启用覆盖层让它重建；不要删除 `mma.db` 或 `arrow/`。

## 11. Windows 部署方案

理论上可以在 Windows 10/11（建议 64 位）上部署。Tauri 本身支持 Windows，`web-serve` 模式会创建隐藏的 WebView2 窗口，因此 Windows 不需要 `Xvfb`。Windows 必须在本机重新编译，不能直接运行 Linux/proot 生成的二进制。

### 11.1 安装环境

首次安装以下组件：

1. Git for Windows。
2. Node.js 24.x，或 nvm-windows；项目要求 `24.15.0` 以上的 24.x。
3. Rust stable MSVC 工具链（使用 rustup 安装）。
4. Visual Studio Build Tools 2022，勾选 **Desktop development with C++**、MSVC、Windows SDK 和 CMake 工具。
5. Microsoft Edge WebView2 Evergreen Runtime。Windows 11 通常已经安装，Windows 10 应手动确认。

安装 Rust 后，在 PowerShell 中确认使用 MSVC：

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustc --version
cargo --version
node --version
npm --version
```

如果源码路径较深，建议启用 Git 长路径支持，并将项目放在例如 `C:\src\mma-cn`：

```powershell
git config --global core.longpaths true
```

### 11.2 获取当前源码

当前百度/腾讯街景改动仍可能只存在于本地工作树，不能直接克隆上游仓库替代当前版本。可以把当前 `mma-cn` 目录复制到 Windows，或从已提交这些改动的个人仓库克隆：

```powershell
cd C:\src\mma-cn\app
```

不要把 Linux/proot 的 `node_modules`、`dist` 或 `src-tauri\target` 一起复制过来；它们应在 Windows 上重新生成。`.env.production.local` 可单独复制，但不要提交到 Git。

### 11.3 配置底图 key（可选）

在 `C:\src\mma-cn\app\.env.production.local` 中写入：

```text
VITE_PETAL_MAP_KEY=你的华为PetalMapsKey
```

源码不内置测试 key，请填写自己的授权 key。Vite 环境变量在构建时写入前端，修改后必须重新执行前端和 Rust 构建。

### 11.4 安装依赖并构建

在 **PowerShell** 或 **Developer PowerShell for VS 2022** 中执行：

```powershell
cd C:\src\mma-cn\app
npm ci
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

服务程序位于：

```text
C:\src\mma-cn\app\src-tauri\target\release\map-making-app.exe
```

首次 Rust 编译可能需要较长时间。`npm run build` 成功后必须继续执行 Cargo 构建，因为前端 `dist` 会被嵌入 `.exe`；只生成 `dist` 不能让旧程序获得新前端。

### 11.5 启动浏览器服务

仅本机访问：

```powershell
cd C:\src\mma-cn\app
$env:MMA_SERVE_ADDR = "127.0.0.1:1430"
& .\src-tauri\target\release\map-making-app.exe --serve
```

浏览器打开：

```text
http://127.0.0.1:1430/
```

局域网访问时，将监听地址改为：

```powershell
$env:MMA_SERVE_ADDR = "0.0.0.0:1430"
& .\src-tauri\target\release\map-making-app.exe --serve
```

然后在 Windows 防火墙中只允许可信局域网访问 1430，例如以管理员 PowerShell 执行：

```powershell
New-NetFirewallRule -DisplayName "MMA-CN 1430 LAN" -Direction Inbound -Protocol TCP -LocalPort 1430 -Action Allow -Profile Private
```

Windows 服务模式没有登录鉴权，不应直接进行公网端口转发。公网访问应通过 IIS/Nginx/Caddy 提供 HTTPS 和认证，并让 MMA 只监听 `127.0.0.1:1430`。

### 11.6 快速检查与后台运行

另开 PowerShell 检查 HTTP：

```powershell
(Invoke-WebRequest http://127.0.0.1:1430/ -UseBasicParsing).StatusCode
```

返回 `200` 才说明完整前端已载入。返回 `404` 通常表示运行的 `.exe` 是在 `dist` 不存在时构建的，需要先执行 `npm run build`，再重新执行 Cargo 构建。

需要开机自动运行时，可使用“任务计划程序”创建任务：

- 触发器：用户登录时或系统启动时
- 操作：启动程序
- 程序：`C:\Program Files\PowerShell\7\pwsh.exe`（或系统 Windows PowerShell）
- 参数：`-File C:\src\mma-cn\start-mma.ps1`
- 起始位置：`C:\src\mma-cn\app`

`start-mma.ps1` 内容：

```powershell
$env:MMA_SERVE_ADDR = "127.0.0.1:1430"
Set-Location "C:\src\mma-cn\app"
& ".\src-tauri\target\release\map-making-app.exe" --serve
```

### 11.7 Windows 数据目录与更新

Windows 默认应用数据通常位于：

```text
C:\Users\<用户名>\AppData\Local\app.map-making.local\
```

实际路径以应用设置页显示为准。停止服务后备份该目录中的 `mma.db`、`arrow`、`plugins`；`cache\tencent-lines.pmtiles` 可以不备份。

更新时执行：

```powershell
cd C:\src\mma-cn\app
npm ci
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

关闭旧的 `map-making-app.exe` 后，再启动新的 release 程序。只修改 React/TS/CSS 或 `VITE_*` 配置时，也必须重新执行 `npm run build` 和 Cargo 构建；仅重启程序不够。

## 迁移到 v0.11.6

使用 Node 26 和 Rust stable。首次构建前执行：

```bash
git submodule update --init --recursive
git lfs pull
```

腾讯覆盖资源 `app/src-tauri/resources/tencent-lines.pmtiles` 应为约 120 MiB 的真实 PMTiles 文件。运行时也可通过 `MMA_TENCENT_COVERAGE_PATH` 指定其绝对路径。

百度详细地址查询使用进程环境变量 `MMA_BAIDU_REVERSE_AK`，请提供自己的 key；缺省使用离线城市表。不要把 key 写入源码。

macOS Apple Silicon 构建：

```bash
cd app
npm ci
npm exec tauri build -- --bundles app --features web-serve
open src-tauri/target/release/bundle/macos/MMA-CN.app
```

首次使用新版本前备份旧应用数据和导出题库。Linux/Termux 浏览器服务继续使用本文的 `map-making-app --serve` 启动方式。
