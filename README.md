# MMA-CN

Linux deployment guide for MMA-CN, a local-first map editor with Baidu and Tencent Street View support. The browser service uses Photo Sphere Viewer (PSV) for panoramas and does not require Google Street View.

[简体中文](#简体中文) · [English](#english)

## 简体中文

### 系统要求

- Ubuntu/Debian Linux（建议 Ubuntu 22.04 或更新版本）
- Node.js 24.x（`24.15.0` 或更高版本）和 npm
- Rust stable、Cargo
- 编译和运行依赖：`build-essential`、`pkg-config`、`libssl-dev`、GTK/WebKitGTK 开发包、`xvfb`
- 确保运行时可访问华为底图、百度街景、腾讯街景及腾讯覆盖数据源

在 Ubuntu/Debian 上安装常用依赖：

```bash
sudo apt update
sudo apt install -y build-essential curl pkg-config libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf xvfb
```

如果发行版没有 `libwebkit2gtk-4.1-dev`，请安装该发行版提供的对应 WebKitGTK 开发包。

### 克隆仓库到本地

```bash
git clone https://github.com/IcaRoNek0/mma-cn.git
cd mma-cn
```

### 安装 Node.js 和 Rust

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
rustup default stable
```

确保 `node` 或 `cargo` 在 `PATH` 中

### 配置华为底图

填写自己的华为 Petal Maps key：

```bash
cd app
cp .env.example .env.production.local
$EDITOR .env.production.local
```

```dotenv
VITE_PETAL_MAP_KEY=你的华为PetalMapsKey
```

### 安装依赖并构建

```bash
cd app
npm ci
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

生成的服务程序为：

```text
app/src-tauri/target/release/map-making-app
```

### 启动浏览器服务

本机访问：

```bash
cd app
MMA_SERVE_ADDR=127.0.0.1:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

然后打开 `http://127.0.0.1:1430/`即可。

### systemd 持久运行（可选）

创建专用用户和目录：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin mma
sudo install -d -o mma -g mma /opt/mma
sudo install -m 0755 app/src-tauri/target/release/map-making-app /opt/mma/map-making-app
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

启用并查看日志：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mma
sudo systemctl status mma
sudo journalctl -u mma -f
```

## English

### Requirements

- Ubuntu/Debian Linux (Ubuntu 22.04 or newer recommended)
- Node.js 24.x (`24.15.0` or newer) and npm
- Rust stable and Cargo
- Build/runtime packages: `build-essential`, `pkg-config`, `libssl-dev`, GTK/WebKitGTK development packages, and `xvfb`
- Runtime network access to Huawei basemap, Baidu Street View, Tencent Street View, and the Tencent coverage source

Install common Ubuntu/Debian packages:

```bash
sudo apt update
sudo apt install -y build-essential curl pkg-config libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf xvfb
```

If `libwebkit2gtk-4.1-dev` is unavailable, install the equivalent WebKitGTK development package supplied by your distribution (for example, `libwebkit2gtk-4.0-dev`).

### Get the source

```bash
git clone https://github.com/IcaRoNek0/mma-cn.git
cd mma-cn
```

### Install Node.js and Rust

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
rustup default stable
```

After opening a new shell, reload the nvm and Cargo environment lines if `node` or `cargo` is not found.

### Configure the Huawei basemap

The source tree does not contain a test key. Copy the template and provide your own Huawei Petal Maps key:

```bash
cd app
cp .env.example .env.production.local
$EDITOR .env.production.local
```

Set at least:

```dotenv
VITE_PETAL_MAP_KEY=your-huawei-petal-maps-key
```

Alternatively, export it only for the build:

```bash
export VITE_PETAL_MAP_KEY='your Huawei Petal Maps key'
```

Changing a `VITE_*` variable requires rebuilding both the frontend and the Rust service. Never commit a real key.

### Install dependencies and build

```bash
cd app
npm ci
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

The release service binary is `app/src-tauri/target/release/map-making-app`.

### Start the browser service

For local access only:

```bash
cd app
MMA_SERVE_ADDR=127.0.0.1:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

Open `http://127.0.0.1:1430/`. Port `5173` is the Vite development port, not the complete deployment entry point.

To allow access from a trusted LAN:

```bash
MMA_SERVE_ADDR=0.0.0.0:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

The service currently has no login/authentication or multi-user conflict handling. Do not expose port 1430 directly to the public Internet. `xvfb-run -a` provides the virtual display required by GTK/WebKit on headless servers.

### Keep it running with systemd (optional)

Use the same `mma` user, `/opt/mma` installation, and systemd unit shown in the Chinese section above, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mma
sudo systemctl status mma
sudo journalctl -u mma -f
```

### Updates and verification

Normal restarts do not require a rebuild. Rebuild the frontend and Rust binary after changing frontend code or `VITE_*` settings; rebuild Rust after changing Rust code; run `npm ci` when `package-lock.json` changes.

Import JSON question banks through the web UI's file upload control. Tencent coverage PMTiles are cached under the application data directory and downloaded again if the cache is missing.

Verify the HTTP endpoint:

```bash
curl -fsS http://127.0.0.1:1430/ -o /dev/null
ss -ltn | grep 1430
```

The editor should load in the browser, including Huawei basemap, Baidu/Tencent Street View, and JSON import.
