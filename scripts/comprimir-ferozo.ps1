param([Parameter(Mandatory = $true)][string]$CarpetaPaquete)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$raiz = (Resolve-Path -LiteralPath $CarpetaPaquete).Path
foreach ($nombre in @('gestion-comercial-servidor', 'gestion-comercial')) {
    $carpeta = Join-Path $raiz $nombre
    if (-not (Test-Path -LiteralPath $carpeta -PathType Container)) { throw "Falta $carpeta" }
    $flujo = [IO.File]::Open((Join-Path $raiz "$nombre.zip"), [IO.FileMode]::Create)
    $zip = New-Object IO.Compression.ZipArchive($flujo, [IO.Compression.ZipArchiveMode]::Create)
    try {
        # En Windows PowerShell, CreateFromDirectory usa barras invertidas.
        # Crear las entradas explicitamente con / para que se extraigan bien en Linux.
        $zip.CreateEntry("$nombre/") | Out-Null
        # El .env de producción tiene secretos: se sube aparte, nunca dentro del ZIP.
        Get-ChildItem -LiteralPath $carpeta -Recurse -Force | Where-Object { $_.Name -ne '.env' } | ForEach-Object {
            $relativa = $_.FullName.Substring($raiz.Length + 1).Replace('\', '/')
            if ($_.PSIsContainer) {
                $zip.CreateEntry("$relativa/") | Out-Null
            } else {
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativa, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        }
    } finally { $zip.Dispose(); $flujo.Dispose() }
}
