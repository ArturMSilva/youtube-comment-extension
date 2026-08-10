# Assets da Chrome Web Store — CommentLens

Arquivos prontos para o formulário de publicação (aba **Loja** → *Recursos gráficos*).

| Arquivo | Tamanho | Onde usar | Obrigatório |
|---|---|---|---|
| `icon-128.png` | 128×128 | Ícone da loja | sim |
| `screenshot-1-1280x800.png` | 1280×800 | Captura de tela 1 (pergunta + resposta) | sim (mín. 1) |
| `screenshot-2-1280x800.png` | 1280×800 | Captura de tela 2 (comentários-fonte) | não |
| `promo-pequeno-440x280.png` | 440×280 | Bloco promocional pequeno | não |
| `promo-marquee-1400x560.png` | 1400×560 | Bloco promocional marquee | não |
| `icon-16/32/48.png` | — | Ícones da barra do Chrome (`manifest.json`) | não |

## Como foram gerados

- **Ícone**: balãozinho do cabeçalho do popup (`popup.html`) sobre o tile verde-escuro, nas cores
  do `popup.css` (`--cl-green: #2BE07C`). Arte de 96×96 centralizada em canvas de 128×128 com
  fundo transparente, como recomenda o guia da Chrome Web Store.
- **Prints**: fundo = captura real de uma página do YouTube (`youtube.com/watch?v=9CgGcXhPy4o`,
  review com capítulo "Bateria/Autonomia/Recarga", que casa com a pergunta do popup), desfocada e
  escurecida; por cima, o popup do TCC (`tcc-comment-lens/imagens/tela-03-resposta.png`) emoldurado
  com sombra e borda verde.
- Tudo renderizado em HTML + Chrome headless. Os fontes desta pasta (`icon.html`, `shot1.html`,
  `shot2.html`, `promo440.html`, `promo1400.html`) ficaram só em diretório temporário e **não
  existem mais** — refazer qualquer um destes assets significa remontar o HTML do zero.
- O popup que aparece nos prints, esse sim, tem fonte versionada: os HTML/CSS que geram
  `tela-0*.png` estão em `tcc-comment-lens/imagens/telas-fonte/`, com o `gerar.sh` do diretório.

## Atenção antes de enviar

O popup usado nos prints é o `tela-03-resposta.png` do TCC. Se essa tela for uma montagem
ilustrativa (e não uma execução real da extensão), troque por um print real do popup em
funcionamento antes de publicar — a política da Chrome Web Store exige que as capturas mostrem
a funcionalidade de verdade.
