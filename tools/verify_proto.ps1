# tools/verify_proto.ps1 -- one-command verification for the single-file prototype
#
# IMPORTANT #1: this file is deliberately ASCII-ONLY, including all path strings.
#   Windows PowerShell 5.1 reads .ps1 as ANSI when the file has no BOM, so any
#   non-ASCII byte can swallow a quote and produce parse errors like
#   "Unexpected token 'bytes:'" or "The '<' operator is reserved".
#   Directory names that contain Chinese characters are therefore DISCOVERED from
#   the filesystem (wildcards / probe files) instead of being written here.
#
# IMPORTANT #2: if the output dir cannot be discovered it falls back to
#   <04_*>/shots and prints the path it used.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File E:\game_design\dista\tools\verify_proto.ps1
#   powershell -ExecutionPolicy Bypass -File ... -OutDir "D:\shots"     # optional override
#
# Steps:
#   1) node tools/build_proto.mjs      rebuild the single-file HTML
#   2) node tools/selfcheck_proto.mjs  logic assertions without a browser
#   3) Edge headless screenshots       7 states
#   4) Edge --dump-dom                 4 states -> title / data-js-error check
#   5) summary                         sizes + per-shot bytes + RESULT line

param(
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Continue'

$Root  = 'E:\game_design\dista'
$Node  = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$Edge  = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$Build = Join-Path $Root 'tools\build_proto.mjs'
$Check = Join-Path $Root 'tools\selfcheck_proto.mjs'

$fail = 0

if (-not (Test-Path $Node)) { Write-Output ('MISSING node: ' + $Node); exit 2 }
if (-not (Test-Path $Edge)) { Write-Output ('MISSING edge: ' + $Edge); exit 2 }

# ---- discover the prototype dir (the one that holds dista_prototype.html) ----
$protoDir = $null
foreach ($d in (Get-ChildItem -Path $Root -Directory -ErrorAction SilentlyContinue)) {
    if (Test-Path (Join-Path $d.FullName 'dista_prototype.html')) { $protoDir = $d; break }
}
if (-not $protoDir) { Write-Output 'MISSING prototype dir (no dista_prototype.html under any subdir)'; exit 2 }
$Html = Join-Path $protoDir.FullName 'dista_prototype.html'

# ---- discover / create the screenshots dir ----
if (-not $OutDir) {
    $pmDir = $null
    foreach ($d in (Get-ChildItem -Path $Root -Directory -ErrorAction SilentlyContinue)) {
        if ($d.Name -like '04_*') { $pmDir = $d; break }
    }
    if (-not $pmDir) { Write-Output 'MISSING project-management dir (04_*)'; exit 2 }

    $candidate = $null
    foreach ($sub in (Get-ChildItem -Path $pmDir.FullName -Directory -ErrorAction SilentlyContinue)) {
        $pngs = @(Get-ChildItem -Path $sub.FullName -Filter 'proto_*.png' -ErrorAction SilentlyContinue)
        if ($pngs.Count -gt 0) { $candidate = $sub; break }
    }
    if ($candidate) {
        $OutDir = $candidate.FullName
    } else {
        $OutDir = Join-Path $pmDir.FullName 'shots'
    }
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Write-Output ('root    : ' + $Root)
Write-Output ('html    : ' + $Html)
Write-Output ('shots   : ' + $OutDir)
Write-Output ''

Write-Output '==== 1/7 build ===='
& $Node $Build
if ($LASTEXITCODE -ne 0) { Write-Output ('BUILD FAILED exit=' + $LASTEXITCODE); exit 3 }
if (-not (Test-Path $Html)) { Write-Output 'BUILD FAILED: html not produced'; exit 3 }
$size = (Get-Item $Html).Length
Write-Output ('html bytes: ' + $size)

Write-Output ''
Write-Output '==== 2/7 logic selfcheck ===='
& $Node $Check
if ($LASTEXITCODE -ne 0) {
    Write-Output ('SELFCHECK FAILED exit=' + $LASTEXITCODE)
    $fail = $fail + 1
}

Write-Output ''
Write-Output '==== 3/7 modes check (M1-M8) ===='
$ModesCheck = Join-Path $Root 'tools\modes_check.mjs'
& $Node $ModesCheck
if ($LASTEXITCODE -ne 0) {
    Write-Output ('MODES CHECK FAILED exit=' + $LASTEXITCODE)
    $fail = $fail + 1
}

Write-Output ''
Write-Output '==== 4/7 audio check (A1-A10) ===='
$AudioCheck = Join-Path $Root 'tools\audio_check.mjs'
& $Node $AudioCheck
if ($LASTEXITCODE -ne 0) {
    Write-Output ('AUDIO CHECK FAILED exit=' + $LASTEXITCODE)
    $fail = $fail + 1
}

Write-Output ''
Write-Output '==== 5/7 render audio (WAV) ===='
$Render = Join-Path $Root 'tools\render_audio.mjs'
& $Node $Render
if ($LASTEXITCODE -ne 0) {
    Write-Output ('RENDER AUDIO FAILED exit=' + $LASTEXITCODE)
    $fail = $fail + 1
}

$uri = ([System.Uri]$Html).AbsoluteUri
Write-Output ('url: ' + $uri)

Write-Output ''
Write-Output '==== 6/7 screenshots ===='

# fxAt=400 freezes the effect clock 400ms after the press, so rings/motes are still in
# flight and the panel has just slid in. Without it the shots land after 1.2s and all
# five ratings look identical -> the animation cannot be reviewed.
# v0.2: ?scene=<id> forces the manual scene channel, ?hour=<0-23> fakes local time,
#       ?mode=relax switches to the infinite calm mode.
$shots = @(
    @{ name = 'proto_home.png';          query = '?screen=home' },
    @{ name = 'proto_home_continue.png'; query = '?screen=home&unlocked=7&best=4400' },
    @{ name = 'proto_home_diag.png';     query = '?screen=home&diag=1' },
    @{ name = 'proto_play.png';          query = '?screen=play&lvl=1&press=0.57' },
    @{ name = 'proto_result.png';        query = '?screen=result&lvl=1&press=0.515&fxAt=400' },
    @{ name = 'proto_result_early.png';  query = '?screen=result&lvl=1&press=0.47&fxAt=400' },
    @{ name = 'proto_result_dual.png';   query = '?screen=result&lvl=10&variant=dual&press=0.58&fxAt=400' },
    @{ name = 'proto_god.png';           query = '?screen=result&lvl=3&press=0.5&fxAt=400' },
    @{ name = 'proto_god_diag.png';      query = '?screen=result&lvl=3&press=0.5&fxAt=400&diag=1' },
    @{ name = 'proto_fail.png';          query = '?screen=result&lvl=1&press=0.8&fxAt=400' },
    @{ name = 'proto_tap_start.png';     query = '?screen=home&progress=6&tap=start' },
    @{ name = 'proto_tap_continue.png';  query = '?screen=home&progress=6&tap=continue' },
    @{ name = 'proto_complete.png';      query = '?screen=complete' },
    @{ name = 'proto_scene_night.png';   query = '?scene=night_station&screen=play&lvl=1&press=0.57' },
    @{ name = 'proto_scene_noon.png';    query = '?scene=noon_window&screen=play&lvl=1&press=0.57' },
    @{ name = 'proto_scene_minimal.png'; query = '?scene=minimal&screen=play&lvl=1&press=0.57' },
    @{ name = 'proto_relax.png';         query = '?mode=relax&screen=play&press=0.55' },
    @{ name = 'proto_challenge.png';     query = '?mode=challenge&screen=play&lvl=5&press=0.57' },
    # v0.3: fxAt beyond panel+1000 lets update() really execute "auto next level",
    # so this shot proves the HUD shows 2/15 and a new object has taken off.
    @{ name = 'proto_advance.png';       query = '?screen=result&lvl=1&press=0.5&fxAt=2000' },
    @{ name = 'proto_tap_challenge.png'; query = '?screen=home&tap=challenge' },
    @{ name = 'proto_tap_relax.png';     query = '?screen=home&tap=relax' },
    # v0.3: challenge countdown (<=3s amber) and the timeout settlement panel
    @{ name = 'proto_timer.png';         query = '?mode=challenge&screen=play&lvl=1&press=0.57&timeLeft=2.4' },
    @{ name = 'proto_timeout.png';       query = '?mode=challenge&screen=play&timeout=1' },
    # 两模式并排：除倒计时外 HUD 必须完全一致（同关卡同 press，最省事的 L1 单物体）
    @{ name = 'proto_hud_challenge.png'; query = '?mode=challenge&screen=play&lvl=1&press=0.55' },
    @{ name = 'proto_hud_relax.png';     query = '?mode=relax&screen=play&lvl=1&press=0.55' },
    # v0.4: season intro / relax level 46 / season-3 god FX (tint from fx.json)
    # NOTE: do NOT combine ?season= with ?at=god — the jump-season branch leaves app.rt
    # half-rebuilt and perfectMs is NaN there. lvl=31 IS season 3 level 1, same meaning.
    @{ name = 'proto_season2.png';       query = '?mode=challenge&screen=play&season=2&press=0.55' },
    @{ name = 'proto_relax60.png';       query = '?mode=relax&screen=play&relaxLvl=46&press=0.55' },
    @{ name = 'proto_fx_season.png';     query = '?mode=challenge&screen=result&lvl=31&at=god&fxAt=400' },
    # v0.5: season-4 late mechanism stack (sine amplitude + inertia + 3 turns in one level)
    @{ name = 'proto_beat_season4.png';  query = '?mode=challenge&screen=play&lvl=58&press=0.55' },
    # v0.6: desync level frozen right after the FIRST of two presses
    #   (one solid dot + one hollow dot; the other object still flying; heatmap only for the frozen mover)
    @{ name = 'proto_desync.png';        query = '?mode=challenge&screen=play&desyncStage=1' }
)

foreach ($s in $shots) {
    $out = Join-Path $OutDir $s.name
    $url = $uri + $s.query
    if (Test-Path $out) { Remove-Item $out -Force }

    $profile = Join-Path $env:TEMP ('dista_edge_' + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
    $edgeArgs = @(
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=720,1280',
        '--virtual-time-budget=2000',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        ('--user-data-dir=' + $profile),
        ('--screenshot=' + $out),
        $url
    )

    $ok = $false
    for ($try = 1; $try -le 3; $try++) {
        & $Edge @edgeArgs 2>$null | Out-Null
        if ((Test-Path $out) -and ((Get-Item $out).Length -gt 0)) { $ok = $true; break }
        Start-Sleep -Milliseconds 400
    }

    if ($ok) {
        $b = (Get-Item $out).Length
        if ($b -lt 8000) {
            Write-Output ($s.name + ' bytes: ' + $b + '  WARN likely blank')
            $fail = $fail + 1
        } else {
            Write-Output ($s.name + ' bytes: ' + $b)
        }
    } else {
        Write-Output ($s.name + ' MISSING')
        $fail = $fail + 1
    }

    if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }
}

# ============================================================
# 6b) 每张截图都做"红条自证"检查
#     错误网在页面顶部画 #FF6B6B 红条；崩溃页整张都是那条红。
#     不做这一步，崩溃图会被当成"成功截图"混过去（proto_fx_season 就是这么漏的）。
# ============================================================
Write-Output ''
Write-Output '==== 6b/screenshots: red-bar self check ===='
$pngs = @()
foreach ($s in $shots) {
    $p = Join-Path $OutDir $s.name
    if (Test-Path $p) { $pngs = $pngs + $p }
}
if ($pngs.Count -gt 0) {
    $PngCheck = Join-Path $Root 'tools\png_check.mjs'
    & $Node $PngCheck @pngs
    if ($LASTEXITCODE -ne 0) {
        Write-Output ('PNG CHECK FAILED exit=' + $LASTEXITCODE + ' → 有截图是报错页，不能算通过')
        $fail = $fail + 1
    }
} else {
    Write-Output 'PNG CHECK: 没有截图可查'
    $fail = $fail + 1
}

Write-Output ''
Write-Output '==== 7/7 dom check ===='

$domChecks = @(
    @{ name = 'home';     query = '?screen=home' },
    @{ name = 'play';     query = '?screen=play&lvl=1&press=0.57' },
    @{ name = 'result';   query = '?screen=result&lvl=1&press=0.515' },
    @{ name = 'complete'; query = '?screen=complete' }
)

foreach ($d in $domChecks) {
    $profile2 = Join-Path $env:TEMP ('dista_edge_dom_' + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
    $domArgs = @(
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=720,1280',
        '--virtual-time-budget=2000',
        '--no-first-run',
        '--no-default-browser-check',
        ('--user-data-dir=' + $profile2),
        '--dump-dom',
        ($uri + $d.query)
    )
    $dom = (& $Edge @domArgs 2>$null | Out-String)

    $domFile = Join-Path $OutDir ('proto_dom_' + $d.name + '.html')
    Set-Content -Path $domFile -Value $dom -Encoding UTF8

    $title = '(not found)'
    if ($dom -match '(?s)<title>(.*?)</title>') { $title = $Matches[1].Trim() }
    $mode = '(not found)'
    if ($dom -match 'data-core-mode="([^"]*)"') { $mode = $Matches[1] }

    # dump-dom also prints the inline script source, which legitimately contains the
    # string JS-ERROR and the attribute NAME data-js-error. So inspect the real tag
    # attribute only (a present attribute has the form:  <html ... data-js-error="1").
    $titleBad = $title -match 'JS-ERROR'
    $attrBad = $dom -match '<html[^>]*\sdata-js-error="1"'

    Write-Output ('dom[' + $d.name + '] chars: ' + $dom.Length + '  title: ' + $title + '  core-mode: ' + $mode)

    if ($dom.Length -lt 300) {
        Write-Output ('dom[' + $d.name + '] FAIL: empty DOM, page did not run')
        $fail = $fail + 1
    } elseif ($titleBad -or $attrBad) {
        Write-Output ('dom[' + $d.name + '] FAIL: page raised JS error')
        $fail = $fail + 1
    } else {
        Write-Output ('dom[' + $d.name + '] PASS: no JS error')
    }

    if (Test-Path $profile2) { Remove-Item $profile2 -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Output ''
Write-Output '==== summary ===='
Write-Output ('html bytes: ' + $size + '  (' + [math]::Round($size / 1024, 1) + ' KB)')
Write-Output ('shots dir: ' + $OutDir)
Write-Output ('shot count: ' + $shots.Count)

# audio deliverables
$audioDir = Join-Path $Root '03_交付素材'
$wavDir = Get-ChildItem -Path $audioDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'audio*' } | Select-Object -First 1
if ($wavDir) {
    $wavs = @(Get-ChildItem -Path $wavDir.FullName -Filter '*.wav' -ErrorAction SilentlyContinue)
    Write-Output ('wav dir   : ' + $wavDir.FullName)
    foreach ($w in $wavs) { Write-Output ('  ' + $w.Name + ' bytes: ' + $w.Length) }
} else {
    Write-Output 'wav dir   : (not found)'
}

if ($fail -eq 0) {
    Write-Output ('RESULT: PASS (' + $shots.Count + ' screenshots, 每张都过红条自检 + ' + $domChecks.Count + ' dom dumps + selfcheck + modes_check + audio_check A1-A10 + wav render)')
    exit 0
} else {
    Write-Output ('RESULT: FAIL (' + $fail + ' problems, see WARN/FAIL lines above)')
    exit 1
}
