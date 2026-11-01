# 贡献指南

感谢你愿意参与 ArQQbot。本文说明开发环境、提交规范与插件贡献流程。

## 开发环境

- Node.js 22 或更高版本
- pnpm 11.7.0（由根 `package.json` 的 `packageManager` 固定）
- Windows 10/11（桌面开发与打包目前仅验证 Windows）

仓库使用 pnpm workspace：

```text
apps/*       桌面应用
packages/*   运行时、QQ 适配器、共享契约与内置插件
```

## 安装与本地命令

```bash
pnpm install
pnpm typecheck        # 全仓类型检查
pnpm test             # 全仓单元测试
pnpm build            # 构建内置插件、运行时与桌面应用
pnpm --filter @arqqbot/desktop dev   # 开发模式启动桌面应用
```

提交前至少执行 `pnpm typecheck`；改动涉及运行时行为时再执行 `pnpm test`。

## 分支与提交

- 从 `master` 创建短生命周期分支，例如 `feat/plugin-marketplace`、`fix/gateway-reconnect`。
- 提交信息遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)：
  - `feat:` 新功能
  - `fix:` 缺陷修复
  - `docs:` 文档
  - `chore:` 工具、依赖、构建
  - `refactor:` 不改变行为的重构
  - `test:` 测试
- 一个提交只做一件事；提交信息使用中文或英文均可，但同一 PR 内保持一致。
- 不要提交 `node_modules`、构建产物、`.env` 或任何密钥。

## 插件贡献流程

1. 阅读 [docs/plugin-spec.md](docs/plugin-spec.md)，确认插件目录结构、Cordis 导出契约与安全边界。
2. 新插件可以从 [plugin-template/](plugin-template/) 复制一份到独立仓库；内置插件放在 `packages/plugin-*`。
3. 插件 `package.json` 必须包含合法的 `arqqbot` manifest：`id` 使用 `^[a-z0-9-]+$`，且全仓唯一。
4. 插件入口必须是预构建的 ESM 产物，运行时依赖需打包，`cordis` 仅作为 type-only 依赖。
5. 社区插件发布后，在 GitHub 仓库打上 topic `arqqbot-plugin`，并在 npm `keywords` 中包含 `arqqbot-plugin`；索引工作流会自动发现。
6. 插件 PR 需要说明：功能、配置项、权限影响、失败时的行为，以及手工验证步骤。

## PR 检查清单

- [ ] 只包含与本次变更相关的改动
- [ ] `pnpm typecheck` 通过
- [ ] 涉及运行时或适配器逻辑时 `pnpm test` 通过
- [ ] 新增/修改的 public API 或插件契约已同步更新文档
- [ ] 没有提交密钥、日志或构建产物
- [ ] 提交信息符合 Conventional Commits

## 代码风格

- 使用 TypeScript，保持 `strict` 与现有 tsconfig 选项通过。
- 2 空格缩进、LF 换行、UTF-8、文件末尾保留换行（见 `.editorconfig`）。
- 优先沿用现有模块分层：`core` / `modules` / `events` / `service`，不要把业务逻辑塞进适配器入口。
- 注释只在需要解释“为什么”时添加；不要为显而易见的代码添加注释。
- 不新增无必要的依赖；需要新依赖时在 PR 中说明理由。

## 安全

发现安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 Issue。参与本项目需遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
