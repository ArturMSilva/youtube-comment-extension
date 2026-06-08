# Documentação Técnica da Extensão "YouTube Comment Q&A"

## 1. Introdução

Este documento detalha a concepção, arquitetura e funcionamento da extensão de navegador "YouTube Comment Q&A", um projeto que visa otimizar a interação do usuário com o vasto volume de comentários em vídeos de *reviews* de produtos no YouTube. A proposta central é mitigar a sobrecarga informacional, permitindo que os usuários obtenham *insights* relevantes de forma rápida e interativa, por meio de um sistema de Question Answering (Q&A) alimentado por Large Language Models (LLMs) e a arquitetura Retrieval-Augmented Generation (RAG).

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

3.  **Processamento e Q&A com LLM (via Backend Proxy):**
    *   Quando o usuário interage com o `Popup UI` (ex: faz uma pergunta), a pergunta é enviada ao `Service Worker`.
    *   O `Service Worker` encaminha a pergunta e os comentários coletados (ou um resumo/embedding deles) para um **Backend Proxy**.
    *   O Backend Proxy, implementado em Python/Flask (ou Node.js), é responsável por:
        *   Proteger a chave de API do LLM (ex: Hugging Face Token).
        *   Receber a pergunta do usuário e os comentários.
        *   Aplicar a arquitetura **Retrieval-Augmented Generation (RAG)**:
            *   **Retrieval:** Seleciona os trechos mais relevantes dos comentários que podem responder à pergunta do usuário.
            *   **Augmentation:** Adiciona esses trechos relevantes ao *prompt* do LLM.
            *   **Generation:** Envia o *prompt* enriquecido ao LLM (ex: Mistral-7B-Instruct-v0.2 ou Qwen/Qwen3-0.6B via Hugging Face Router) para gerar a resposta.
        *   Retornar a resposta do LLM ao `Service Worker`.

4.  **Exibição da Resposta:**
    *   O `Service Worker` recebe a resposta do LLM do Backend Proxy.
    *   Encaminha a resposta para o `Popup UI`.
    *   O `Popup UI` exibe a resposta ao usuário de forma clara e organizada.

## 5. Tecnologias Utilizadas

| Categoria | Tecnologia | Propósito no Projeto |
| :--- | :--- | :--- |
| **Desenvolvimento da Extensão** | HTML, CSS, JavaScript | Construção da interface (Popup UI) e lógica de interação (Content Script, Service Worker). |
| **API de Coleta de Dados** | YouTube Data API v3 | Extração programática de comentários de vídeos do YouTube. |
| **Backend Proxy** | Node.js | Servidor intermediário para proteger chaves de API, orquestrar chamadas a LLMs e implementar a lógica RAG. |
| **Modelos de Linguagem (LLMs)** | Mistral-7B-Instruct-v0.2, Qwen/Qwen3-0.6B | Modelos de IA para compreensão de linguagem natural e geração de respostas. |
| **Plataforma de Inferência LLM** | Hugging Face Inference API / Router | Serviço para hospedar e executar a inferência dos LLMs. |
| **Técnica de IA** | Retrieval-Augmented Generation (RAG) | Aprimora a precisão e a relevância das respostas do LLM, ancorando-as em informações recuperadas dos comentários. |

## 6. Estado Atual do Projeto (Conforme Discussões)

O projeto está em fase de planejamento e prototipagem conceitual, com as seguintes etapas já definidas e algumas com rascunhos de implementação:

*   **Fase 1: Estrutura e Extração de ID:** Os arquivos básicos da extensão (`manifest.json`, `popup.html`, `popup.css`, `content.js`) foram delineados. A lógica para extrair o `videoId` da URL do YouTube via `content.js` está concebida.
*   **Fase 2: Coleta de Comentários com Paginação:** A estratégia para o `service-worker.js` realizar chamadas paginadas à YouTube Data API v3 para coletar comentários foi definida.
*   **Fase 3: Interface e Comunicação:** A estrutura do `popup.js` para gerenciar a interface do usuário e a comunicação com o `service-worker.js` para enviar perguntas e receber respostas está planejada.
*   **Fase 4: Integração com LLM (Q&A):** A necessidade de um **Backend Proxy** para segurança da chave de API e a implementação da lógica RAG foram estabelecidas. Modelos como Mistral-7B-Instruct-v0.2 e Qwen/Qwen3-0.6B (via Hugging Face Router) foram identificados como candidatos para testes.

## 7. Desafios e Soluções Abordadas

| Desafio | Solução Proposta |
| :--- | :--- |
| **Volume de Comentários (Paginação)** | Implementação de lógica de paginação no `Service Worker` para múltiplas chamadas à API do YouTube. |
| **Segurança da Chave de API (LLM)** | Utilização de um **Backend Proxy** para intermediar as chamadas ao LLM, mantendo a chave de API no servidor e não na extensão. |
| **Limite de Contexto do LLM** | Aplicação da arquitetura **RAG** para selecionar e enviar apenas os trechos mais relevantes dos comentários ao LLM, otimizando o uso do contexto. |
| **Acesso a Modelos Gated (Hugging Face)** | Verificação e aceitação dos termos de uso na página do modelo no Hugging Face, ou uso de modelos totalmente públicos/alternativos para testes iniciais. |

## 8. Próximos Passos

Os próximos passos envolvem a implementação prática das fases delineadas, com foco na construção do Backend Proxy, na integração dos componentes da extensão e na validação do fluxo completo de Q&A. Testes iterativos e depuração serão cruciais para garantir a funcionalidade e a robustez da solução. Este documento servirá como um guia para o desenvolvimento e a documentação do projeto ao longo do TCC.
