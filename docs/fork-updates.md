# Fork 版本的应用内更新

本仓库的更新源为 `https://github.com/hchcx/cursor-byok`。

- Windows 客户端读取 `portable-latest.json`，校验 ZIP 签名后替换正在运行的程序。
- macOS / Linux 客户端读取 `latest.json`，使用 Tauri 更新插件安装更新。
- 更新地址和签名公钥随客户端一起编译。原作者的已安装版本仍使用原作者的更新源，首次必须手动安装本 fork 的版本；此后才可以在应用内检查本 fork 的更新。
- GitHub Release 及其附件必须能够公开下载；当前更新器没有为私有仓库配置 GitHub 身份认证。

## 一次性配置

1. 在 GitHub 的 `hchcx/cursor-byok` 仓库启用 Actions，允许发布工作流运行。`main` 的推送或合并权限同时也是发版权限，建议为该分支设置保护规则。
2. 在 `Settings → Secrets and variables → Actions → Secrets` 中添加：
   - `BYOK`：本地 `.tauri/cursor-byok.key` 的完整内容。工作流将此 Secret 传入 Tauri 要求的 `TAURI_SIGNING_PRIVATE_KEY` 环境变量。
   - 当前密钥没有密码，因此不要设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。有密码的密钥才需要该 Secret。
3. 安全备份 `.tauri/cursor-byok.key`。`.tauri/` 已被 Git 忽略，私钥禁止提交、输出到工作流日志或作为 Release 附件上传。
4. `apps/desktop/src-tauri/tauri.conf.json` 中的 `plugins.updater.pubkey` 已设置为本 fork 的公钥，应与 `.tauri/cursor-byok.key.pub` 相同。

私钥必须跨版本保持一致。丢失私钥后，用另一把私钥签名的更新无法被已经安装的客户端接受。新机器应恢复备份；`make build-desktop` 缺少密钥时会停止，不会自动换一把密钥。

## 每次发布

在仓库根目录执行版本同步命令，例如：

```sh
node .github/scripts/desktop-version.mjs set 1.0.2
```

它只修改版本文件，不编译、不打标签、不提交、不推送。版本必须大于当前版本，格式为正式版 `MAJOR.MINOR.PATCH`，不使用 beta 或 GitHub prerelease。

脚本同步以下五个文件，独立的 `cursor-server` 版本保持不变：

- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/package.json`
- `apps/desktop/package-lock.json`（顶层及根包版本）
- `Cargo.lock`（仅 `cursor-byok-desktop` 包版本）

将业务修改和这五个版本文件一起提交、推送到 `main`。无需手动打标签，也无需手动创建 Release。

1. 发布工作流比较本次推送前后的版本，并验证五个版本文件一致。
2. 版本不变时跳过发布；版本降低或版本文件不一致时直接失败。
3. 版本提升时构建 Windows、Linux、macOS 更新包，签名并上传为草稿 Release。
4. 所有平台成功、更新清单上传完成后，才发布为 GitHub 最新正式 Release。
5. 等待 Actions 的 `Release desktop app` 成功后，在已安装的 fork 客户端点击“检查更新”，确认下载并安装。

仅推送代码、保留相同版本号，不会发布新版本。发布耗时取决于 GitHub Actions 的构建队列和各平台构建速度，推送后立即检查可能还没有更新。

## 故障处理

- 提示 `BYOK signing secret is not configured`：先配置仓库 Secret，再重新运行该次失败的工作流。
- 提示标签已经属于其他提交：选择更高的新版本；不要删除、移动已有标签或覆盖已经发布的版本。
- 构建失败：草稿不会成为最新正式版，客户端仍然使用上一个成功发布的版本。修复代码后使用更高版本发布。
- 签名校验失败：检查 Actions 中的私钥是否与客户端内的公钥配对。保持签名校验开启，不要通过跳过验证解决。
- 仍然检查原作者版本：确认正在运行的程序已经手动更换为本 fork 的安装包。修改源码不会改变旧程序内的更新地址。

## 本地轻量校验

以下命令不编译应用：

```sh
node .github/scripts/desktop-version.mjs check
node --test .github/scripts/desktop-version.test.mjs .github/scripts/generate-portable-update.test.mjs
```

完整应用的编译、测试和线上发布分别需要明确授权；本次配置修改不代表已执行这些操作。
