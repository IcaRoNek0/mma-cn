# 新对话首轮提示词

将下面整段作为新对话的第一条消息：

```text
请接手 MMA-CN 项目。项目目录是：

/data/data/com.termux/files/home/tuxun/mma-cn

开始前请完整阅读：

- /data/data/com.termux/files/home/tuxun/mma-cn/PROJECT_CONTEXT.md
- /data/data/com.termux/files/home/tuxun/mma-cn/README.md
- /data/data/com.termux/files/home/tuxun/mma-cn/DEPLOYMENT.md

然后执行只读检查：

- git status --short
- git log -5 --oneline --decorate
- git remote -v

本轮先不要修改、提交或推送任何文件。请根据当前代码和 Git 状态，用简洁中文告诉我：

1. 当前分支、工作树和远程仓库状态；
2. 已实现的百度/腾讯街景、PSV、底图和覆盖层能力；
3. 当前已知的 ESLint 与 JS/i18n CI 问题；
4. 继续开发前最需要注意的 API、凭据和坐标系约定。

重要约束：

- 以当前工作区代码和 Git 历史为准，不要仅依赖文档中的历史结论。
- 保留并尊重任何已有未提交修改，不要擅自回退。
- 百度/腾讯业务坐标保持 GCJ-02，OSM/标准 MapLibre 坐标是 WGS84；服务边界转换要明确，避免重复纠偏。
- 现有百度/腾讯 panoId、元数据和瓦片 API 可以真实调用；如果需要引入新的 API 功能或新的接口用途，先询问我。
- 不要在源码、日志、提交或压缩包中泄露 API key、Cookie、Token。华为 key 由 VITE_PETAL_MAP_KEY 提供。
- 除非我明确要求，本轮不要修改文件，也不要执行提交、推送或发布。

完成概述后等待我的下一条指令。
```
