# GitHub 同步（game_test）

| 项 | 值 |
| --- | --- |
| 远端仓库 | https://github.com/James9Luo/game_test （public，初始为空仓，默认分支 `main`） |
| 同步方向 | 本地 → 远端（首次把工程骨架全量推上去） |
| git 二进制 | 便携版 MinGit 2.56.0.2，落在 `temp/tools/MinGit/`（`temp/` 已被忽略，不进仓库、不进包体） |
| 认证方式 | SSH ed25519：私钥 `%USERPROFILE%\.ssh\id_ed25519_dista`，公钥已加到 GitHub 账号 `James9Luo` |
| 提交身份 | `James9Luo <110089269+James9Luo@users.noreply.github.com>`（GitHub 分配的 noreply 邮箱，不暴露真实邮箱） |
| 分支策略 | 主干 `main` 直推；有第二个程序时改 `main` + `feat/*` |

## 1. 本机环境（实测 2026-10-18）

| 检查项 | 结果 |
| --- | --- |
| 系统 git / gh CLI / winget / choco / scoop | 全部不存在（Win10 19041，无 winget） |
| GitHub Desktop | 不存在 |
| 系统 ssh | `C:\Windows\System32\OpenSSH\ssh.exe` ✅ |
| 网络到 GitHub | 通 ✅ |

结论：这台机器**只有便携 git**。新终端里直接敲 `git` 会报「无法识别」，必须用完整路径或先加 alias。

## 2. 日常命令（复制即用）

```powershell
$git = "E:\game_design\dista\temp\tools\MinGit\cmd\git.exe"

# 看状态 / 提交 / 推送（三连）
& $git status
& $git add -A
& $git commit -m "feat: 一句话说清改了什么"
& $git push

# 拉取（多机 / 多人时先拉再改）
& $git pull --rebase
```

可选：把 MinGit 加进当前用户 PATH，之后直接敲 `git`。

```powershell
$p = "E:\game_design\dista\temp\tools\MinGit\cmd"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$p", "User")
# 重开终端生效
```

## 3. 硬规矩

1. `build/` `library/` `temp/` `local/` `profiles/` 永不入库（`.gitignore` 已挡）。
2. `.meta` 必须入库，删了会丢资源引用。
3. 单文件 >50MB 先停下来开一次讨论；`02_美术源文件/` 的 PSD 在仓库到 1GB 前必须定 Git LFS（见 `决策记录.md` 待定项）。
4. `temp/tools/MinGit` 是工具不是项目内容，不要为了「方便」把它挪进 `assets/`。

## 4. 回滚

- 误提交大文件：`git rm --cached <file>` 后提交，再清历史需 `filter-repo`（届时由程序执行并写进版本日志）。
- 误把源文件放进 `assets/`：从 `assets/` 删掉，还原到 `02_美术源文件/`，重新走导出链。
