# MMA-CN

MMA-CN is an unofficial modified fork of MMA (https://github.com/ccmdi/mma).
Linux deployment guide for MMA-CN, a local-first map editor with Baidu and Tencent Street View support (include Tencent trekker). The browser service uses Photo Sphere Viewer (PSV) for panoramas and does not support Google Street View.

MMA-CN是map-making app的改版，支持加载百度/腾讯街景（含腾讯trekker）。

# 部署教程

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

---

## English

### System Requirements

- Ubuntu/Debian Linux (Ubuntu 22.04 or newer recommended)
- Node.js 24.x (`24.15.0` or higher) and npm
- Rust stable, Cargo
- Build and runtime dependencies: `build-essential`, `pkg-config`, `libssl-dev`, GTK/WebKitGTK development packages, `xvfb`
- Ensure that Huawei basemap, Baidu Street View, Tencent Street View, and Tencent coverage data sources are accessible at runtime

Install common dependencies on Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y build-essential curl pkg-config libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf xvfb
```

If your distribution does not provide `libwebkit2gtk-4.1-dev`, install the equivalent WebKitGTK development package provided by that distribution.

### Clone the Repository

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

Ensure `node` and `cargo` are in your `PATH`.

### Configure Huawei Basemap

Fill in your own Huawei Petal Maps key:

```bash
cd app
cp .env.example .env.production.local
$EDITOR .env.production.local
```

```dotenv
VITE_PETAL_MAP_KEY=your_huawei_petal_maps_key
```

### Install Dependencies and Build

```bash
cd app
npm ci
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

The generated service binary is located at:

```text
app/src-tauri/target/release/map-making-app
```

### Start the Browser Service

For local access:

```bash
cd app
MMA_SERVE_ADDR=127.0.0.1:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

Then open `http://127.0.0.1:1430/` in your browser.

### systemd Persistent Service (Optional)

Create a dedicated user and directory:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin mma
sudo install -d -o mma -g mma /opt/mma
sudo install -m 0755 app/src-tauri/target/release/map-making-app /opt/mma/map-making-app
```

Create `/etc/systemd/system/mma.service`:

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

Enable and view logs:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mma
sudo systemctl status mma
sudo journalctl -u mma -f
```
