# 插件市场与发现机制

- 适用版本：ArQQbot 0.1+
- 状态：索引与规范已建立；市场 UI 尚未实现

当前版本提供**插件索引**与**安装流程约定**，用于发现和手动安装插件。桌面应用尚未内置市场界面，索引本身不执行安装、不自动启用插件。

## 1. 索引地址

默认索引由本仓库的 GitHub Actions 每周生成并提交：

```text
https://raw.githubusercontent.com/Arooxy/ArQQbot/master/plugins/index.json
```

索引文件路径为 `plugins/index.json`，构建脚本为 `scripts/build-plugin-index.mjs`。仓库地址变更时只需替换上述 URL 中的 `Arooxy/ArQQbot`。

## 2. 索引 JSON 结构

```json
{
  "version": 1,
  "generatedAt": "2026-11-01T00:00:00.000Z",
  "source": "github-topic:arqqbot-plugin",
  "plugins": [
    {
      "id": "example",
      "packageName": "arqqbot-plugin-example",
      "displayName": "示例插件",
      "description": "最小可运行的插件示例",
      "version": "0.1.0",
      "repo": "https://github.com/owner/arqqbot-plugin-example",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "downloadUrl": "https://codeload.github.com/owner/arqqbot-plugin-example/tar.gz/0123456789abcdef0123456789abcdef01234567",
      "homepage": "https://github.com/owner/arqqbot-plugin-example#readme",
      "tags": ["arqqbot-plugin"],
      "sha256": null
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 是 | 索引格式版本，当前固定为 `1` |
| `generatedAt` | 是 | 索引生成时间，ISO 8601 UTC |
| `source` | 是 | 来源标识，当前为 `github-topic:arqqbot-plugin` |
| `plugins` | 是 | 插件条目数组，按 `id` 升序 |
| `plugins[].id` | 是 | manifest 中的 `arqqbot.id` |
| `plugins[].packageName` | 是 | npm 包名 |
| `plugins[].displayName` | 是 | manifest 中的显示名 |
| `plugins[].description` | 是 | manifest 中的描述，可为空字符串 |
| `plugins[].version` | 是 | 包版本，semver |
| `plugins[].repo` | 是 | 仓库 HTML 地址 |
| `plugins[].commit` | 是 | 生成索引时解析到的提交 SHA；无法解析时退回分支引用 |
| `plugins[].downloadUrl` | 是 | codeload tarball 地址，固定到 commit 或 `refs/heads/<branch>` |
| `plugins[].homepage` | 否 | 插件主页 |
| `plugins[].tags` | 否 | 发现用标签，当前为 `arqqbot-plugin` |
| `plugins[].sha256` | 否 | tarball 摘要；当前生成器不计算，值为 `null` |

完整结构见 [plugin-index.schema.json](plugin-index.schema.json)（JSON Schema 2020-12）。

## 3. GitHub topic 聚合

索引构建流程：

1. 使用 GitHub Search API 查询 `topic:arqqbot-plugin`，每页最多 100 条，最多 10 页。
2. 对每个仓库读取默认分支上的 `package.json`（`raw.githubusercontent.com`）。
3. 校验 `name`、`version` 与 `arqqbot` manifest（`id` 正则、`displayName`、`schema`、`defaultConfig`）。
4. 解析默认分支 commit SHA，生成固定到 commit 的 `downloadUrl`；解析失败时退回 `refs/heads/<branch>`。
5. 无效仓库被跳过并计数，结果按 `id` 排序写入 `plugins/index.json`。

因此插件作者只需要：

- 在 GitHub 仓库打上 topic `arqqbot-plugin`
- 在 `package.json` 的 `keywords` 中包含 `arqqbot-plugin`
- 保证默认分支包含合法 `package.json` 与预构建入口

索引更新为每周一 UTC 自动运行，也可通过 `workflow_dispatch` 手动触发。

## 4. 自定义索引地址

索引是普通 JSON 文件，任何同构地址都可以作为自定义源，例如自建静态站点或内部镜像：

```text
https://example.com/arqqbot/plugins/index.json
```

约定：

- 返回 `application/json`，结构必须符合 `plugin-index.schema.json`。
- 必须使用 HTTPS；不要从不受信任的源加载索引。
- `downloadUrl` 应指向不可变的 commit tarball，避免内容漂移。
- 自定义索引同样不构成信任背书；安装前仍需检查插件代码与 manifest。

当前版本没有市场设置界面；自定义索引需要通过后续市场功能或手动流程使用。无论索引来自哪里，安装与启用都由用户手动完成。

## 5. 安装流程

以下流程适用于手动安装，也是未来市场 UI 应遵循的步骤：

1. **下载 tarball**  
   从索引的 `downloadUrl` 下载 `.tar.gz`。优先使用固定 commit 的地址，而不是分支地址。
2. **校验 SHA-256（可选）**  
   若索引条目提供 `sha256`，计算下载文件摘要并比对；不一致则终止安装。当前生成器将 `sha256` 置为 `null`。
3. **解包到临时目录**  
   解压到用户数据目录之外的临时位置，避免未校验内容直接进入插件目录。
4. **校验 manifest 与入口**  
   读取 `package.json`，按插件规范校验 `arqqbot` manifest；检查 `main`（缺省 `dist/index.js`）存在且为文件。任一失败则删除临时目录并终止。
5. **复制到外部插件目录**  
   将插件目录复制到 `<userData>/plugins/<插件目录名>`。目录名建议使用包名或 `arqqbot.id`，避免覆盖已有插件。
6. **重启实例**  
   宿主只在实例启动时扫描插件目录；复制后必须重启对应实例。
7. **手动启用**  
   在实例插件页面检查插件信息与配置项，确认后手动启用。默认不会自动启用。

## 6. 信任等级

| 等级 | 当前状态 | 校验内容 |
| --- | --- | --- |
| L1 | 已实现 | manifest 合法性、入口文件存在、预构建产物 |
| L2 | 规划中 | 可选 SHA-256 强校验、来源与版本锁定 |
| L3 | 规划中 | 权限声明与运行时能力限制 |
| L4 | 规划中 | 代码签名、可复现构建与发布者身份校验 |

即使达到更高等级，也不等同于对插件行为的安全保证。L1 只降低配置错误风险，不能阻止恶意代码。

## 7. 失败与回滚

- **下载或摘要失败**：删除临时文件，不改动插件目录。
- **manifest / 入口校验失败**：删除临时目录，现有插件保持不变。
- **复制中断**：先复制到目标目录下的临时子目录，完成后再原子替换；失败时删除临时子目录。
- **覆盖升级**：安装前将旧目录移动到备份位置；新版本复制完成后再删除备份。启用失败时可恢复旧目录并重启实例。
- **插件挂载失败**：宿主会把插件状态标记为 `error`，不会自动启用；插件目录仍保留，便于排查。修复或回滚后重启实例。
- **配置校验失败**：宿主回滚到上一次配置并重新挂载；若回滚也失败，插件保持 `error` 状态。

回滚建议：停止实例 → 恢复插件目录 → 重启实例 → 重新启用插件。

## 8. 安全提示

- 外部插件拥有 Worker 的 Node.js 权限，没有沙箱；安装即信任。
- 只从可信来源下载插件，优先选择固定 commit 的 tarball。
- 安装前阅读插件源码与 README，确认其申请的能力、网络请求与数据存储行为。
- 不要安装要求关闭安全软件、绕过平台限制或索取 AppSecret 的插件。
- 发现恶意插件请通过 [SECURITY.md](../SECURITY.md) 私下报告，不要在公开 Issue 中披露未修复漏洞。
- 索引条目不构成官方背书；`arqqbot-plugin` topic 只表示仓库声明了插件身份。
