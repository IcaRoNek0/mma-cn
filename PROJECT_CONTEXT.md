# MMA-CN 项目上下文

最后核对日期：2026-10-10

当前迁移分支 `migrate/upstream-0.11.6` 已合入上游 v0.11.6（`5433b539`），保留百度/腾讯独立 PSV、华为底图、覆盖层、透明度三档和原版 LocalGuessr。本文后续历史路径和版本记录需要结合新源码阅读；Rust 模块已迁到 `src/net` 和 `src/io`。

本文档供新的 Codex/开发会话快速恢复上下文。代码、Git 历史和实际测试结果始终优先于本文；开始工作前应先重新检查工作区。

## 1. 项目身份

- 本地目录：`/data/data/com.termux/files/home/tuxun/mma-cn`
- GitHub：`https://github.com/IcaRoNek0/mma-cn.git`
- 当前分支：`master`
- 上游项目：`https://github.com/ccmdi/mma`
- 许可证：MIT，发布时必须保留根目录 `LICENSE` 中的版权、许可和致谢。
- 当前定制提交：`bbb70a2e feat: add China Street View browser deployment`

MMA-CN 是 MMA 的中国街景定制版本。目标是保留 MMA 原有界面和题库编辑能力，将核心街景工作流改为支持百度和腾讯，并使用 Photo Sphere Viewer（PSV）显示街景，不再以 Google Street View 作为百度/腾讯查看器。

原始 MMA 的 `master` 主要使用 OpenSV/Google Street View，不原生支持百度或腾讯街景。上游 PR #104 正在加入 Apple Look Around、百度和腾讯，但截至 2026-08-20 仍未合并；该 PR 的百度/腾讯实现通过 Google/OpenSV 注入兼容层显示，只有 Apple Look Around 主要使用 PSV，因此不能直接代替本项目的独立 PSV 方案。

## 2. 用户要求和固定约定

### API 约定

- 必须调用真实的百度/腾讯街景 API，包括 panoId 查询、元数据和瓦片。
- 已经实现并在项目中使用的 API 可以继续调用和调试。
- 如果任务需要引入一种新的 API 功能或新的接口用途，先向用户说明需求并询问，不要自行试探新接口。
- 不要输出任何真实凭据。用户于 2026-10-10 明确授权恢复旧版百度逆地理编码 Cookie 和 AK 到源码及编译产物；仅这组旧版百度请求凭据适用该例外。华为 key 仍不进入主仓库源码。
- 华为 Petal Maps key 只能由用户通过 `VITE_PETAL_MAP_KEY` 提供；源码不含测试 key。

### 坐标系约定

- 百度/腾讯题目在项目业务层保持 GCJ-02，与原始图寻数据约定一致。
- 百度服务边界按需要执行 GCJ-02、BD-09/BD09MC 转换。
- 腾讯服务边界使用其接口所需的坐标形式，但存储和编辑语义保持 GCJ-02。
- OSM/标准 MapLibre 地理坐标是 WGS84；不能把 OSM 当成 GCJ-02。
- 修改导入、导出、点击查找、覆盖层或逆地理编码时，必须明确输入与输出坐标系，避免重复纠偏。

### 产品约定

- 保持 MMA 当前界面基调，不进行整体重新设计。
- 百度/腾讯街景使用 PSV；Google Street View 不再是这两个 provider 的查看器。
- 腾讯 Trekker 当前按 8×2 瓦片处理。
- 街景移动功能目前可以不实现。
- 百度/腾讯先加载低清瓦片，再主动加载高层级瓦片，避免必须放大后才变清晰。
- “点击地图查找附近街景”有独立开关。
- 未选中标记不透明度按钮按 `100% -> 35% -> 0%` 循环。
- 当前浏览器服务没有用户系统、登录鉴权或多人编辑冲突处理，不适合多人同时编辑同一题库，也不能直接暴露到公网。

## 3. 已实现功能

- 百度和腾讯街景 provider、panoId/元数据解析与真实瓦片加载。
- 百度普通街景、腾讯普通街景和腾讯 Trekker 的 PSV 显示。
- 百度低清到高清渐进瓦片加载，以及腾讯对应的分层加载逻辑。
- 百度街景覆盖道路瓦片。
- 腾讯覆盖 PMTiles 的服务端本地缓存和远程回退。
- 华为 Petal Maps 栅格底图，key 由 Vite 环境变量注入。
- 地图点击查找附近百度/腾讯街景的可选开关。
- 百度 panoId 逆地理编码和离线回退逻辑。
- JSON 导入/导出相关兼容调整和文件上传入口。
- 地图标记边界/透明度改进；工具栏提供未选中标记 100%、35%、0% 三档按钮。
- 浏览器 `web-serve` 部署和腾讯覆盖缓存的 Rust 后端支持。
- 简体中文界面增量翻译。

## 4. 关键文件

### 街景 provider 与 PSV

- `app/src/lib/pano/types.ts`：provider 公共类型、来源和瓦片层级数据结构。
- `app/src/lib/pano/baidu.ts`：百度查询、元数据、时间线与链接。
- `app/src/lib/pano/tencent.ts`：腾讯普通街景/Trekker 元数据和瓦片布局。
- `app/src/lib/pano/coords.ts`：中国坐标转换。
- `app/src/lib/pano/fetch.ts`：provider 网络请求辅助。
- `app/src/lib/sv/panoSingleton.ts`：PSV 单例、provider 切换和全景加载。
- `app/src/components/editor/location/LocationPreview.tsx`：地点预览与街景生命周期。
- `app/src/components/editor/location/PsvControls.tsx`：PSV 控件。

### 地图、覆盖层与点击

- `app/src/lib/map/chinaBasemap.ts`：华为底图和腾讯覆盖地址。
- `app/src/lib/map/baiduCoverage.ts`：百度街景覆盖瓦片转换与渲染。
- `app/src/lib/map/tencentCoverage.ts`：腾讯 PMTiles 本地缓存源。
- `app/src/lib/map/maplibreHost.ts`：MapLibre host、底图和覆盖图层。
- `app/src/lib/map/mapClick.ts`：点击地图查找附近街景并创建地点。
- `app/src/components/editor/map/MapSettingsPanel.tsx`：provider、覆盖层和点击开关设置。
- `app/src/components/editor/map/MapEmbed.tsx`：地图工具栏和标记透明度按钮。
- `app/src/store/mapEmbedPrefs.ts`：地图偏好和透明度三档循环。

### Rust/browser 服务

- `app/src-tauri/src/serve.rs`：Tauri `web-serve` 入口。
- `app/src-tauri/src/tencent_coverage.rs`：腾讯 PMTiles 下载、缓存和范围读取。
- `app/src-tauri/src/geocoder.rs`：逆地理编码相关逻辑。
- `app/src-tauri/src/import.rs`、`export.rs`：导入导出兼容。

### 文档和配置

- `README.md`：仅 Linux 的中英文部署说明。
- `DEPLOYMENT.md`：Termux/proot、Linux、systemd 和故障排查的完整说明。
- `app/.env.example`：无凭据的 Vite 环境变量模板。
- `.github/workflows/lint.yml`：ESLint、TypeScript、Rust 和 JS 测试 CI。

## 5. 构建和启动

推荐在 Ubuntu/Debian 或 Termux 的 Debian/Ubuntu proot 内使用 Node 26 和 Rust stable。不要复用 Android Termux 原生环境生成的 `node_modules`。

```bash
cd /data/data/com.termux/files/home/tuxun/mma-cn/app
npm ci
export VITE_PETAL_MAP_KEY='用户自己的华为 Petal Maps key'
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features web-serve --release
```

无桌面 Linux/proot 中启动：

```bash
cd /data/data/com.termux/files/home/tuxun/mma-cn/app
MMA_SERVE_ADDR=127.0.0.1:1430 xvfb-run -a \
  ./src-tauri/target/release/map-making-app --serve
```

浏览器打开 `http://127.0.0.1:1430/`。`5173` 只是 Vite 开发端口，不是完整应用入口。日常启动不需要重新编译；前端或 `VITE_*` 变化后需要重新执行前端构建并重新构建 Rust 二进制，因为前端资源会嵌入二进制。

## 6. 当前测试和已知问题

开始新任务前先重新运行相关检查，不要把以下历史结果当作永久状态。

历史上已通过：

```bash
cd app
node node_modules/typescript/bin/tsc6 -p tsconfig.app.json --noEmit
cargo check --lib --manifest-path src-tauri/Cargo.toml
git diff --check
```

当前 GitHub CI 已知失败：

1. ESLint 有一个阻塞错误：`app/src/lib/map/mapClick.ts` 的 `catch (error)` 未使用 `error`。可保持相同行为改成 `catch`；其他 10 项是 Hook/IPC warning，不会在当前无 `--max-warnings=0` 的命令下单独造成失败。
2. JS tests 中只有 `app/test/unit/i18n.test.tsx` 失败：100 个测试文件中 99 个通过，1412 个测试中 1398 个通过、14 个失败。
3. i18n 原因是 `en.json`/`en-XA.json` 已按新源码生成，但 `de/es/fr/ja/pl/ru` 缺少 7 个新键并保留 5 个旧键；`zh-Hans` 已有新键但仍保留 5 个旧键。目录一致性测试要求所有语言键集合完全相同。
4. 本机 Termux 直接运行 Vitest 曾因缺少 Android 平台的 Rolldown/Rollup 可选原生绑定而无法启动。这是本地依赖平台问题；GitHub Ubuntu runner 可以正常运行测试并暴露上述 i18n 失败。

修复 CI 时不要简单地把所有 React Hook warning 的变量加入依赖数组；地图 host 或街景 viewer 的 effect 可能因此重复销毁和初始化。应逐项分析闭包和生命周期。

## 7. 题库和数据

- 用户曾提供测试题库 `maps/export(2).json`，名称为“西藏小蓝点”；实际存在性应在新会话中重新检查。
- 不要把用户题库、缓存、数据库、编译产物或真实环境变量提交到 Git，除非用户明确要求。
- 分发包应排除 `.git/`、`app/node_modules/`、`app/dist/`、`app/src-tauri/target/`、本地 `.env*`（保留 `.env.example`）及已有压缩包。

## 8. 开始新任务时的工作规则

1. 先执行 `git status --short`、`git log -5 --oneline --decorate` 和 `git remote -v`。
2. 阅读本文件及与任务直接相关的源码；以实际代码为准。
3. 工作树出现未知修改时先确认来源，不覆盖或回退用户改动。
4. 用户只要求研究、解释或规划时，不修改代码。
5. 用户要求实现时，先做最小范围修改，再运行相关类型检查、测试和 `git diff --check`。
6. 未经用户明确要求，不自行提交、推送、发布或更改远程状态。
7. 不输出凭据。提交与打包遵循第 2 节的百度明确授权例外，其他凭据不得纳入。

## 9. v0.11.6 迁移补充

- 构建需初始化子模块和下载 Git LFS 资源：`git submodule update --init --recursive`、`git lfs pull`。腾讯 PMTiles 不能用三行 LFS 指针代替。
- 根据用户要求恢复旧版百度逆地理编码 AK 和 Cookie；`MMA_BAIDU_REVERSE_AK` 仍可覆盖默认 AK。请求失败时使用离线城市表。
- 自动安装更新保持关闭，避免中国定制版被上游安装包替换。发布列表读取本 fork。
- 桌面及浏览器入口仍兼容 `map-making-app --serve`（构建需 `--features web-serve`）。
- macOS Apple Silicon 可执行 `cd app && npm exec tauri build -- --bundles app --features web-serve`；产物在 `app/src-tauri/target/release/bundle/macos/MMA-CN.app`。
- 上游已改变数据库与地图格式。第一次打开旧数据前请备份应用数据目录和导出的题库；用户数据不纳入迁移提交。
