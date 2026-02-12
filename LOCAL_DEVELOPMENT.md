# 本地开发版本配置指南

本文档说明如何在本地使用修改后的 ccusage 系列工具。

## 本地版本包含的修复

- **ccusage**: 修复 `anthropic/claude-opus-4.6` 和 `anthropic/claude-haiku-4.5` 价格计算为 0 的问题
- **ccusage-amp**: 支持 Amp 新版数据格式（使用 `message.usage` 替代 `usageLedger.events`）
- **ccusage-opencode**: 为 `daily --json` 输出添加 `modelBreakdowns` 按模型明细
- **ccusage-amp**: 为 `daily --json` 输出添加 `modelBreakdowns` 按模型明细

## 前置要求

- [Bun](https://bun.sh/) - JavaScript 运行时
- [pnpm](https://pnpm.io/) - 包管理器
- Git

## 快速配置步骤

### 1. 克隆仓库

```bash
git clone https://github.com/i-richardwang/ccusage.git
cd ccusage
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置 alias

在 `~/.zshrc`（或 `~/.bashrc`）中添加：

```bash
# ccusage local development (Claude Code usage)
alias ccusage="bun /path/to/ccusage/apps/ccusage/src/index.ts"

# ccusage-amp local development (Amp usage)
alias ccusage-amp="bun /path/to/ccusage/apps/amp/src/index.ts"

# ccusage-opencode local development (OpenCode usage)
alias ccusage-opencode="bun /path/to/ccusage/apps/opencode/src/index.ts"

# ccusage-codex local development (Codex usage)
alias ccusage-codex="bun /path/to/ccusage/apps/codex/src/index.ts"
```

**注意**：将 `/path/to/ccusage` 替换为你的实际克隆路径。

### 4. 删除全局安装的官方版本

如果之前通过 npm/pnpm 全局安装过官方版本，需要先删除，否则全局命令会优先于 shell alias：

```bash
# 检查是否存在全局安装
which ccusage
which ccusage-amp
which ccusage-opencode
which ccusage-codex

# 删除 npm 全局安装的 ccusage
npm uninstall -g ccusage

# 删除 pnpm 全局安装的 @ccusage/amp
pnpm remove -g @ccusage/amp

# 删除 pnpm 全局安装的 @ccusage/opencode
pnpm remove -g @ccusage/opencode

# 删除 pnpm 全局安装的 @ccusage/codex
pnpm remove -g @ccusage/codex
```

### 5. 生效配置

```bash
source ~/.zshrc
```

### 6. 验证

```bash
ccusage daily
ccusage-amp daily
ccusage-opencode daily
ccusage-codex daily
```

## 使用说明

### ccusage (Claude Code 用量统计)

```bash
ccusage daily      # 每日报告
ccusage monthly    # 每月报告
ccusage session    # 按会话报告
ccusage blocks     # 5小时计费块报告
ccusage --help     # 查看帮助
```

### ccusage-amp (Amp 用量统计)

```bash
ccusage-amp daily      # 每日报告
ccusage-amp monthly    # 每月报告
ccusage-amp session    # 按会话报告
ccusage-amp --help     # 查看帮助
```

### ccusage-opencode (OpenCode 用量统计)

```bash
ccusage-opencode daily      # 每日报告
ccusage-opencode monthly    # 每月报告
ccusage-opencode session    # 按会话报告
ccusage-opencode --help     # 查看帮助
```

### ccusage-codex (Codex 用量统计)

```bash
ccusage-codex daily      # 每日报告
ccusage-codex monthly    # 每月报告
ccusage-codex session    # 按会话报告
ccusage-codex --help     # 查看帮助
```

## 修改代码后

使用 bun 运行源码的好处是**修改代码后立即生效**，无需重新构建。

## 同步上游更新

```bash
# 添加上游远程（仅需一次）
git remote add upstream https://github.com/ryoppippi/ccusage.git

# 拉取并合并上游更新
git fetch upstream
git merge upstream/main
```

### 合并特定 PR

```bash
# 拉取 PR 到本地分支
git fetch upstream pull/<PR号>/head:pr-<PR号>

# 合并到当前分支
git cherry-pick <commit-hash>
```

## 为什么不用 pnpm link --global？

`pnpm link --global` 在 Node.js 24 下会遇到 JSON 导入属性的兼容性问题。使用 bun 直接运行源码是最简单可靠的方式。
