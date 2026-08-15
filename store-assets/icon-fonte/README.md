# Fonte dos ícones da extensão

Arte versionada dos ícones declarados no `manifest.json` (`icons` e `action.default_icon`).

```
bash store-assets/icon-fonte/gerar.sh   # regenera icons/icon-{16,32,48,128}.png
```

- `icone.html` — o balão de fala do cabeçalho do popup (`popup.html`) sobre um tile arredondado,
  nas cores do `popup.css` (`--cl-green: #2BE07C` sobre `#1A211E → #0D100F`). Fundo transparente.
- Cada tamanho tem seu próprio perfil (`PERFIS`, dentro do HTML): quanto menor o canvas, menor a
  margem e mais grosso o traço, senão o balão some na barra de ferramentas. No 16×16 o tile ocupa
  o quadro inteiro e não tem borda.
- Renderização em Chrome headless (`--screenshot`).

## Pegadinha do Chrome headless

Janela de exatamente **128×128 devolve captura vazia** (16, 32, 48 e ≥200 funcionam normalmente).
Por isso o ícone de 128 é renderizado numa janela de 512 (`?px=512`, que escala o perfil) e
reduzido para 128 com bicúbica de alta qualidade via `System.Drawing`.
