# 以太画廊 Ether Gallery

> 每一次对话，都是一张未完成的画卷。  
> 纯前端、本地优先的 LLM HTML 片段收纳/预览/截图工具。

- 仪表盘网格：已存页面的缩略图卡片 + 新建卡片，支持拖入 `.html` 或备份 `.json` 导入。
- 工作区：代码编辑（CodeMirror）、一键预览、截图（snapdom）、自动保存。
- IndexedDB 持久化，支持数据导出/导入。
- 截图时自动更新缩略图，列表即时刷新。

Live demo（参考）：`canvas.closeai.moe`

## 本地运行

需要 [Bun](https://bun.sh/)（或 Node 也可，但脚本默认 bun）。

```bash
bun install
bun run dev
```

访问 `http://localhost:5173/`。

## 构建

```bash
bun run build
```

产物在 `dist/`。

## 自部署

1. 克隆仓库：`git clone https://github.com/senzi/llm-render-box.git && cd llm-render-box`
2. 安装依赖：`bun install`
3. 构建静态文件：`bun run build`
4. 将 `dist/` 上传到任意静态托管（Vercel、Netlify、Cloudflare Pages、静态服务器等）。

## License

MIT © senzi
