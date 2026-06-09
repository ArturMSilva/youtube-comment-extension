# Documentação Técnica da Extensão "YouTube Comment Q&A"

## 1. Introdução

Este documento detalha a concepção, arquitetura e funcionamento da extensão de navegador "YouTube Comment Q&A", um projeto que visa otimizar a interação do usuário com o vasto volume de comentários em vídeos de *reviews* de produtos no YouTube. A proposta central é mitigar a sobrecarga informacional, permitindo que os usuários obtenham *insights* relevantes de forma rápida e interativa, por meio de um sistema de Question Answering (Q&A) alimentado por Large Language Models (LLMs) e a arquitetura Retrieval-Augmented Generation (RAG).

> **Nota de versão:** Este documento foi atualizado para refletir o estado atual e funcional do projeto. A solução foi implementada com um backend serverless em **Node.js/TypeScript hospedado na Vercel** e utiliza o modelo **Llama 3.3-70B via plataforma Groq** (com *fallback* para Mixtral 8x7B). Configurações anteriormente cogitadas (Python/Flask, Hugging Face com Mistral/Qwen) foram substituídas por essa stack durante o desenvolvimento.

## 2. Conceitos Fundamentais de Extensões de Navegador

Extensões de navegador são pequenos programas de software que personalizam a experiência de navegação, adicionando funcionalidades ou modificando o comportamento de páginas web. Elas são construídas predominantemente com tecnologias web padrão (HTML, CSS, JavaScript) e operam dentro de um ambiente isolado, mas com capacidade de interagir com o conteúdo das páginas e com serviços externos.

### 2.1. Arquitetura (Manifest V3)

As extensões modernas, especialmente no Google Chrome e navegadores baseados em Chromium, aderem ao **Manifest V3**. Esta arquitetura impõe um modelo de segurança mais robusto e um ciclo de vida diferente para os *scripts* de fundo. Os principais componentes incluem:

*   **`manifest.json`:** O arquivo de configuração central da extensão. Ele define metadados (nome, versão), permissões necessárias (acesso a URLs, APIs), e registra os *scripts* de fundo (`Service Worker`), *scripts* de conteúdo (`Content Script`) e a interface do *popup* (`Popup UI`).
*   **`Service Worker` (Lógica de Fundo):** Substitui os antigos *background scripts*. É um *script* JavaScript que roda em segundo plano, mas de forma *event-driven* (orientada a eventos). Ele é ativado apenas quando necessário (ex: ao receber uma mensagem, ao fazer uma requisição de rede) e pode ser encerrado pelo navegador para economizar recursos. É responsável por tarefas de longa duração, como chamadas a APIs externas, gerenciamento de estado e comunicação entre outros componentes da extensão.
*   **`Content Script`:** Um *script* JavaScript que é injetado diretamente no contexto de uma página web específica (no nosso caso, páginas de vídeos do YouTube). Ele pode ler e modificar o DOM da página, mas não tem acesso direto às variáveis JavaScript da página. Sua principal função é extrair informações da página (como o ID do vídeo) e se comunicar com o `Service Worker`.
*   **`Popup UI`:** A interface de usuário que aparece quando o usuário clica no ícone da extensão na barra de ferramentas do navegador. É uma página HTML (`popup.html`) com seus próprios *scripts* JavaScript (`popup.js`) e estilos CSS (`popup.css`). É o ponto de interação primário do usuário com a extensão.

### 2.2. Comunicação entre Componentes

A comunicação entre esses componentes é assíncrona e baseada em mensagens. O `Content Script` pode enviar mensagens para o `Service Worker`, e o `Popup UI` também pode se comunicar com o `Service Worker`. O `Service Worker` atua como um orquestrador, recebendo requisições e coordenando as ações necessárias, incluindo chamadas a APIs externas.

## 3. A Extensão "YouTube Comment Q&A": Visão Geral

### 3.1. Problema Endereçado

A extensão visa resolver a **sobrecarga informacional** e a **ineficiência da análise manual** de comentários em vídeos de *reviews* de produtos no YouTube. A natureza não estruturada e o alto volume desses dados dificultam a identificação rápida de *insights* relevantes, impactando negativamente a tomada de decisão do consumidor.

### 3.2. Funcionalidade Principal

O cerne da extensão é permitir que o usuário faça perguntas em linguagem natural sobre os comentários de um vídeo do YouTube e receba respostas concisas e embasadas, sem a necessidade de ler todos os comentários. Isso é alcançado através da integração de LLMs e RAG.

### 3.3. Benefícios para o Usuário

*   **Redução do Esforço Cognitivo:** Elimina a necessidade de leitura exaustiva de comentários.
*   **Tomada de Decisão Aprimorada:** Fornece *insights* rápidos e relevantes para decisões de compra.
*   **Eficiência:** Otimiza o tempo gasto na pesquisa de produtos.
*   **Interatividade:** Permite uma interação natural com o conteúdo dos comentários.

## 4. Arquitetura e Fluxo de Dados da Extensão

A arquitetura da extensão é modular, dividida em componentes que se comunicam para orquestrar o fluxo de dados e a interação com o usuário. O fluxo de dados pode ser sumarizado em quatro etapas principais:

1.  **Extração do ID do Vídeo:**
    *   O `Content Script` é injetado na página do YouTube quando um vídeo é carregado.
    *   Ele extrai o `videoId` diretamente da URL da página.
    *   Este `videoId` é enviado ao `Service Worker`.

2.  **Coleta de Comentários:**
    *   O `Service Worker` recebe o `videoId`.
    *   Utiliza a **YouTube Data API v3** para coletar os comentários do vídeo. A coleta é paginada (`maxResults=100` por requisição) para garantir a recuperação de um volume significativo de comentários, iterando com `nextPageToken`.
    *   Os comentários coletados são armazenados temporariamente ou enviados para o Backend Proxy para processamento.

3.  **Processamento e Q&A com LLM (via Backend Serverless):**
    *   Quando o usuário interage com o `Popup UI` (ex: faz uma pergunta), a pergunta é enviada ao `Service Worker`.
    *   O `Service Worker` encaminha a pergunta e os comentários coletados para o **Backend serverless** (endpoint `POST /api/ask` na Vercel).
    *   O Backend, implementado em **Node.js/TypeScript** e hospedado na **Vercel (Serverless Functions)**, é responsável por:
        *   Proteger a chave de API do LLM (`GROQ_API_KEY`), mantida como variável de ambiente no servidor.
        *   Receber a pergunta do usuário e os comentários.
        *   Aplicar a arquitetura **Retrieval-Augmented Generation (RAG)**:
            *   **Retrieval:** Seleciona os trechos mais relevantes dos comentários por pontuação de palavras-chave (até os 30 comentários mais pertinentes).
            *   **Augmentation:** Adiciona esses trechos relevantes ao *prompt* do LLM, numerados com suas contagens de *likes*.
            *   **Generation:** Envia o *prompt* enriquecido ao LLM (**Llama 3.3-70B via Groq**, com *fallback* automático para **Mixtral 8x7B** em caso de *rate limit*) para gerar a resposta.
        *   Retornar a resposta do LLM, junto com os comentários que a embasaram, ao `Service Worker`.

4.  **Exibição da Resposta:**
    *   O `Service Worker` recebe a resposta do LLM do Backend Proxy.
    *   Encaminha a resposta para o `Popup UI`.
    *   O `Popup UI` exibe a resposta ao usuário de forma clara e organizada.

## 5. Tecnologias Utilizadas

| Categoria | Tecnologia | Propósito no Projeto |
| :--- | :--- | :--- |
| **Desenvolvimento da Extensão** | HTML, CSS, JavaScript | Construção da interface (Popup UI) e lógica de interação (Content Script, Service Worker). |
| **API de Coleta de Dados** | YouTube Data API v3 | Extração programática de comentários de vídeos do YouTube. |
| **Backend Serverless** | Node.js + TypeScript (Vercel) | Servidor intermediário para proteger chaves de API, orquestrar chamadas a LLMs e implementar a lógica RAG. |
| **Modelos de Linguagem (LLMs)** | Llama 3.3-70B (primário), Mixtral 8x7B (fallback) | Modelos de IA para compreensão de linguagem natural e geração de respostas. |
| **Plataforma de Inferência LLM** | Groq API | Serviço de inferência de baixa latência para execução dos LLMs. |
| **Testes** | Vitest | Testes automatizados do backend (filtro RAG e parsing das respostas). |
| **Técnica de IA** | Retrieval-Augmented Generation (RAG) | Aprimora a precisão e a relevância das respostas do LLM, ancorando-as em informações recuperadas dos comentários. |

## 6. Estado Atual do Projeto

O projeto está **funcional e testado de ponta a ponta**, operando sem erros. Todas as fases planejadas foram implementadas:

*   **Fase 1: Estrutura e Extração de ID:** Os arquivos da extensão (`manifest.json`, `popup.html`, `popup.css`, `content.js`) estão implementados. O `content.js` extrai o `videoId` da URL do YouTube e lida com a navegação SPA do site via `MutationObserver`.
*   **Fase 2: Coleta de Comentários com Paginação:** O `service-worker.js` realiza chamadas paginadas à YouTube Data API v3 (100 comentários por página, até 5 páginas / 500 comentários), com controle de progresso.
*   **Fase 3: Interface e Comunicação:** O `popup.js` gerencia a interface (coleta, pergunta e exibição de respostas + fontes), com persistência via `chrome.storage.local` e renderização segura contra XSS.
*   **Fase 4: Integração com LLM (Q&A):** O **backend serverless na Vercel** (Node.js/TypeScript) está implementado e em produção, protegendo a `GROQ_API_KEY` e aplicando a lógica RAG. O modelo em uso é o **Llama 3.3-70B via Groq**, com *fallback* para **Mixtral 8x7B**.
*   **Versionamento e Testes:** O código de ambos os módulos (extensão e backend) está versionado no GitHub, e o backend conta com testes automatizados em **Vitest**.

## 7. Desafios e Soluções Abordadas

| Desafio | Solução Proposta |
| :--- | :--- |
| **Volume de Comentários (Paginação)** | Implementação de lógica de paginação no `Service Worker` para múltiplas chamadas à API do YouTube. |
| **Segurança da Chave de API (LLM)** | Utilização de um **backend serverless** para intermediar as chamadas ao LLM, mantendo a `GROQ_API_KEY` como variável de ambiente no servidor e não na extensão. |
| **Limite de Contexto do LLM** | Aplicação da arquitetura **RAG** para selecionar e enviar apenas os ~30 comentários mais relevantes ao LLM, otimizando o uso do contexto e o custo por requisição. |
| **Disponibilidade e Latência do Modelo** | Uso da plataforma **Groq** (inferência de baixa latência) com **fallback automático** para um modelo secundário (Mixtral 8x7B) em caso de *rate limit* (HTTP 429). |
| **Segurança no Navegador (CORS / XSS)** | CORS restrito a origens `chrome-extension://` e `http://localhost`; renderização dos comentários via `textContent` (nunca `innerHTML`) para prevenir XSS. |

## 8. Próximos Passos

Com a solução já funcional e testada, os próximos passos envolvem a elaboração do **artigo / relatório técnico** do TCC e melhorias incrementais. Em destaque:

*   **Documentação dos resultados:** registrar os testes realizados e os resultados obtidos para compor o relatório técnico.
*   **Melhoria de segurança planejada:** mover também a chave da YouTube Data API para o backend, deixando a extensão sem nenhuma credencial exposta (atualmente a `API_KEY` do YouTube ainda fica no `config.js` da extensão).
*   **Refinamentos do RAG:** avaliar técnicas de recuperação mais sofisticadas (ex: embeddings semânticos) como evolução do filtro atual por palavras-chave.

Este documento servirá como guia para o desenvolvimento e a documentação do projeto ao longo do TCC.
