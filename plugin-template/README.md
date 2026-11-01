# ArQQbot 插件模板

最小可运行的 Cordis 插件，监听 c2c / 群聊消息并通过 `ctx.qq.send` 被动回复。

## 在 ArQQbot 仓库内使用

将整个 `plugin-template/` 目录复制到 `packages/` 下，例如 `packages/plugin-example/`，然后：

1. 修改 `package.json`：
   - `name` 改为 `@arqqbot/plugin-example`（内置插件命名）或 `arqqbot-plugin-example`（社区插件）
   - `arqqbot.id` 改为全局唯一的 id，匹配 `^[a-z0-9-]+$`
   - `arqqbot.displayName`、`arqqbot.description` 改为实际内容
   - 删除模板中的 `repository`、`homepage`、`bugs` 占位，或替换为真实地址
2. 根 `package.json` 的 `build` 脚本按需加入该包。
3. 运行：

```bash
pnpm --filter @arqqbot/plugin-example build
pnpm --filter @arqqbot/plugin-example typecheck
```

内置插件会随桌面应用一起打包，无需单独发布。

## 独立构建与发布

1. 把模板目录复制到仓库外，`pnpm install` 后即可独立开发。
2. 运行 `pnpm build`，确认 `dist/index.js` 已生成。
3. 把构建产物提交到仓库。**宿主不会在安装时执行构建**，GitHub tarball 必须包含 `dist/`。
4. 修改 `package.json` 中的 `repository`、`homepage`、`bugs` 为真实地址，`license` 保持有效许可证。
5. 发布 npm 包（可选）：

```bash
pnpm build
npm publish --access public
```

6. 在 GitHub 仓库打上 topic **`arqqbot-plugin`**，并确保 `keywords` 包含 `arqqbot-plugin`。

## 如何进入插件索引

索引工作流每周一 UTC 通过 GitHub Search API 聚合 topic `arqqbot-plugin` 的仓库，读取默认分支上的 `package.json`，校验 `arqqbot` manifest 后写入 [plugins/index.json](../plugins/index.json)。

进入索引的前提：

- 仓库公开，且已打上 topic `arqqbot-plugin`
- 默认分支的 `package.json` 包含合法 `arqqbot` manifest（`id`、`displayName`、`schema`、`defaultConfig`）
- 默认分支包含预构建入口（`main`，缺省 `dist/index.js`）
- `package.json` 的 `keywords` 包含 `arqqbot-plugin`

索引只负责发现，不代表审核或安全背书。用户安装后需要重启实例并手动启用插件。

更多约定见 [docs/plugin-spec.md](../docs/plugin-spec.md) 与 [docs/plugin-marketplace.md](../docs/plugin-marketplace.md)。
