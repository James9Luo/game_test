# GitHub 同步（game_test）

| 项 | 值 |
| --- | --- |
| 远端仓库 | https://github.com/James9Luo/game_test （public，初始为空仓，默认分支 `main`） |
| 同步方向 | 本地 → 远端（首次把工程骨架全量推上去） |
| git 二进制 | 便携版 MinGit 2.56.0.2，落在 **`E:\game_design\tools\MinGit\`**（项目目录之外 —— `temp/` 会被引擎当缓存清掉，工具不能放里面） |
| 认证方式 | SSH ed25519：私钥 `%USERPROFILE%\.ssh\id_ed25519_dista`，公钥已加到 GitHub 账号 `James9Luo` |
| 提交身份 | `James9Luo <110089269+James9Luo@users.noreply.github.com>`（GitHub 分配的 noreply 邮箱，不暴露真实邮箱） |
| 分支策略 | 主干 `main` 直推；有第二个程序时改 `main` + `feat/*` |
| 连接通路 | **SSH over 443**（`ssh.github.com:443`）：本机直连 22 端口 TCP 能通但握手会挂；已写进 `%USERPROFILE%\.ssh\config` 的 `Host github.com` 段 |

## 1. 本机环境（实测 2026-10-18）

| 检查项 | 结果 |
| --- | --- |
| 系统 git / gh CLI / winget / choco / scoop | 全部不存在（Win10 19041，无 winget） |
| GitHub Desktop | 不存在 |
| 系统 ssh | `C:\Windows\System32\OpenSSH\ssh.exe` ✅ |
| 网络到 GitHub | `api.github.com` 与 443 SSH 通；**Release CDN 拉不动**（38MB 的 MinGit 反复 0 字节），大文件一律走 `registry.npmmirror.com` 镜像 |

结论：这台机器**只有便携 git**。新终端里直接敲 `git` 会报「无法识别」，必须用完整路径或先加 alias。

## 2. 日常命令（复制即用）

```powershell
$git = "E:\game_design\tools\MinGit\cmd\git.exe"

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
$p = "E:\game_design\tools\MinGit\cmd"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$p", "User")
# 重开终端生效
```

## 3. 硬规矩

1. `build/` `library/` `temp/` `local/` `profiles/` 永不入库（`.gitignore` 已挡）。
2. `.meta` 必须入库，删了会丢资源引用。
3. 单文件 >50MB 先停下来开一次讨论；`02_美术源文件/` 的 PSD 在仓库到 1GB 前必须定 Git LFS（见 `决策记录.md` 待定项）。
4. MinGit 是工具不是项目内容，永远留在 `E:\game_design\tools\`，不要挪进项目、更不要进 `assets/`。

## 4. 回滚

- 误提交大文件：`git rm --cached <file>` 后提交，再清历史需 `filter-repo`（届时由程序执行并写进版本日志）。
- 误把源文件放进 `assets/`：从 `assets/` 删掉，还原到 `02_美术源文件/`，重新走导出链。

## 5. 实测记录

| 日期 | 动作 | 结果 |
| --- | --- | --- |
| 2026-10-18 | 首推 `main` | ✅ commit `31ef808`，37 个文件 / 1337 行，远端 `main` 已跟踪 |
| 2026-10-18 | SSH 认证 | ✅ `Hi James9Luo!`（443 端口） |
| 2026-10-18 | 暂存校验 | ✅ `build/ library/ temp/ local/ profiles/` 只有 `.gitkeep` 入库，缓存目录 0 条 |
| 2026-10-19 | 第 2 次推送（v0.7 四线改造） | ✅ commit `4490faa`，**215 个文件 / 33.1 MB**；暂存审计：缓存目录 0 条、无 >50MB 单文件（最大 = `03_交付素材/audio/bgm_loop.wav` 2.5 MB）；推后 `main` 干净（ahead 0 / behind 0） |

新机器复现的三条最小命令（凭据需各自生成并加到 GitHub）：

```powershell
& "E:\game_design\tools\MinGit\cmd\git.exe" clone git@github.com:James9Luo/game_test.git
cd game_test
& "E:\game_design\tools\MinGit\cmd\git.exe" remote -v
```

