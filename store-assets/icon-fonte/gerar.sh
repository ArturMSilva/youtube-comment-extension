#!/usr/bin/env bash
# Gera os ícones da extensão (icons/icon-*.png) a partir de icone.html.
# Uso: bash store-assets/icon-fonte/gerar.sh   (a partir da raiz do repositório)
#
# Renderiza icone.html?size=N em Chrome headless, com fundo transparente.
# O ícone de 128 é renderizado em 512 e reduzido: o Chrome headless devolve
# captura vazia quando a janela tem exatamente 128×128.
set -euo pipefail

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
DESTINO="$RAIZ/icons"
HTML="file:///$(cygpath -m "$AQUI/icone.html")"

mkdir -p "$DESTINO"

# "tamanho final:janela de renderização"
for PAR in 16:16 32:32 48:48 128:512; do
  SIZE="${PAR%%:*}"
  PX="${PAR##*:}"
  OUT="$DESTINO/icon-$SIZE.png"

  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --screenshot="$(cygpath -w "$OUT")" \
    --window-size="$PX,$PX" \
    "$HTML?size=$SIZE&px=$PX" \
    >/dev/null 2>&1

  if [ "$PX" != "$SIZE" ]; then
    powershell.exe -NoProfile -Command "
      Add-Type -AssemblyName System.Drawing
      \$src = [System.Drawing.Image]::FromFile('$(cygpath -w "$OUT")')
      \$dst = New-Object System.Drawing.Bitmap($SIZE, $SIZE)
      \$g = [System.Drawing.Graphics]::FromImage(\$dst)
      \$g.InterpolationMode = 'HighQualityBicubic'
      \$g.PixelOffsetMode = 'HighQuality'
      \$g.SmoothingMode = 'HighQuality'
      \$g.DrawImage(\$src, 0, 0, $SIZE, $SIZE)
      \$g.Dispose(); \$src.Dispose()
      \$dst.Save('$(cygpath -w "$OUT")', [System.Drawing.Imaging.ImageFormat]::Png)
      \$dst.Dispose()
    " >/dev/null
  fi

  echo "gerado: icons/icon-$SIZE.png (${SIZE}×${SIZE}, renderizado em ${PX})"
done

# Os arquivos de store-assets/ (ícone da loja, prints, banners) são independentes
# e não são tocados aqui.
