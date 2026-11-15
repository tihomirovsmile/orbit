$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = [Drawing.Bitmap]::new(64,64)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::FromArgb(18,23,36))
$pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(153,189,255),6)
$graphics.DrawEllipse($pen,14,14,36,36)
$dot = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(232,242,255))
$graphics.FillEllipse($dot,43,11,12,12)
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [IO.File]::Create((Join-Path $PSScriptRoot '../build/desktop/Orbit.ico'))
try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose(); $dot.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
