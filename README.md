<div align="center">

<img src="icons/icon-512.png" alt="" width="96">

# Pop Collection

Controle as compras, os pagamentos, a chegada, a coleção e a wishlist dos seus photocards.

[![Abrir o app](https://img.shields.io/badge/abrir_o_app-5b3fd6?style=for-the-badge)](https://renokkj.github.io/pop-collection/)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-222222?logo=githubpages&logoColor=white)

<br>

<img src="docs/app-computador.png" alt="Tela inicial do Pop Collection no computador" width="68%">&nbsp;
<img src="docs/app-celular.png" alt="Tela inicial do Pop Collection no celular" width="24%">

<sub>Telas com dados de teste.</sub>

</div>

## Sobre o projeto

Criei o Pop Collection para resolver um problema meu: acompanhar quanto já paguei, o que falta pagar e quais photocards ainda estão a caminho. Depois ele virou também o lugar da minha coleção (o Binder) e dos cards que eu quero ter (a Wishlist). Foi o primeiro projeto que idealizei do zero, da ideia ao app publicado.

## O que o app faz

O app tem cinco seções: **Início**, **Compras**, **Binder**, **Wishlist** e **Financeiro**. No computador elas ficam na barra lateral; no celular, na barra de baixo.

### Compras

- **Registrar compra:** foto, nome, grupo de K-pop, vendedor, categoria, preço, fretes e data da compra. O total é calculado sozinho. Dá para registrar vários cards de uma vez com "+ Adicionar outro photocard".
- **Colar a foto:** no computador, copie uma imagem e aperte Ctrl+V (Cmd+V no Mac) no cadastro.
- **Categorias:** Individual ou CEG, Nacional ou Internacional. O formulário mostra só os fretes e a taxa de importação de cada categoria. Na CEG, você informa só a sua parte do que é dividido.
- **Presente:** um card que você ganhou não tem custo e vai direto para a Chegada.
- **Pedidos:** os cards comprados juntos ficam num pedido, e os fretes e a taxa contam uma vez só. Registrar dois ou mais cards de uma vez cria o pedido sozinho. Na página do pedido dá para registrar um card comprado depois, trazer um card já cadastrado, tirar um card do pedido e editar o nome, a categoria e os fretes.
- **Três abas:** Pagamento (marque cada valor pago), Chegada (com tudo pago, aguarde e toque em "Chegou ✓") e Concluídas.
- **Busca e filtros** por nome, grupo de K-pop e categoria.

### Binder

- **A coleção em grade, só com as fotos.** Toda compra que chega entra no Binder sozinha.
- **Adicionar ao Binder:** para os cards que você já tem, com foto, nome e grupo, sem valores.
- **Pastas** com nome e capa. Excluir uma pasta não apaga os cards.
- **Detalhes ao tocar na foto:** uma compra mostra vendedor, valores, pagamento e chegada; um card do Binder mostra grupo e data. Dá para mover de pasta, editar e excluir.
- **Excluir uma compra pelo Binder** pergunta se é para tirar só do Binder (a compra continua em Concluídas) ou excluir o card e a compra.
- **Selecionar** vários cards para mover de pasta ou definir o grupo de uma vez.

### Wishlist

- **Os cards que você quer ter**, com foto, nome, grupo e pastas próprias.
- **Adquiri este photocard:** "Comprei" abre o cadastro de compra já preenchido, e o card entra em Pagamento; "Já está comigo" leva o card direto para o Binder. O card não é duplicado.

### Início e Financeiro

- **Início:** total investido, já pago e falta pagar; quantos cards aguardam pagamento, estão a caminho, estão no Binder e na Wishlist; pagamentos pendentes com "Marcar pago"; próximas chegadas com "Chegou ✓".
- **Financeiro:** quanto foi em photocards, fretes e taxas; gasto dos últimos 12 meses em colunas; gasto por mês e por categoria. Só as compras entram nos valores.

### Para todo o app

- **Contas individuais:** cada pessoa só vê os próprios cards.
- **Botão + no celular:** em Compras, no Binder e na Wishlist ele abre o cadastro da seção; nas outras telas, mostra as opções. No computador, o mesmo fica no "+ Novo".
- **Recuperar a senha** pelo link "Esqueci minha senha".
- **Tema claro e escuro**, conforme o dispositivo.
- **Instalar como app:** no celular ou no computador, adicione o site à tela inicial.

## Como funciona

```mermaid
flowchart LR
    W[Wishlist] -->|Comprei| P
    W -->|Já está comigo| B
    N[+ Registrar compra] --> P[Pagamento]
    N -->|presente| C
    P -->|tudo pago| C[Chegada]
    C -->|Chegou ✓| B[Binder]
    A[+ Adicionar ao Binder] --> B
```

1. **Registrar:** a compra entra em Pagamento (ou direto na Chegada, se for presente).
2. **Pagamento:** marque cada valor pago. Num pedido, os fretes e a taxa são marcados uma vez só, no próprio pedido.
3. **Chegada:** com tudo pago, o card espera aqui até você tocar em "Chegou ✓".
4. **Binder:** o card que chegou aparece na grade, e a compra fica em Concluídas com os valores.
5. **Wishlist:** quando conseguir um card desejado, toque em "Adquiri este photocard".

## Telas

<table>
  <tr>
    <td width="50%"><img src="docs/compras.png" alt="Compras com as abas Pagamento, Chegada e Concluídas"><br><sub><b>Compras:</b> as abas Pagamento, Chegada e Concluídas, com busca e filtros.</sub></td>
    <td width="50%"><img src="docs/pedido.png" alt="Página de um pedido com os fretes e os cards comprados juntos"><br><sub><b>Pedido:</b> fretes e taxa uma vez só, registrar ou trazer cards e tirar do pedido.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/binder.png" alt="Binder no computador com pastas e grade de fotos"><br><sub><b>Binder:</b> pastas no topo, busca, filtro por grupo e a grade só com as fotos.</sub></td>
    <td width="50%"><img src="docs/wishlist.png" alt="Wishlist com pastas e os cards desejados"><br><sub><b>Wishlist:</b> os cards que você quer ter, com pastas próprias.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/financeiro.png" alt="Financeiro com a divisão do gasto e o gráfico dos últimos 12 meses"><br><sub><b>Financeiro:</b> para onde vai o dinheiro e o gasto dos últimos 12 meses.</sub></td>
    <td width="50%"><img src="docs/cadastro-compra.png" alt="Janela de registrar compra"><br><sub><b>Registrar compra:</b> categoria, pedido, data da compra, pasta no Binder e os dados de cada card.</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/celular-binder.png" alt="Binder no celular" width="24%">&nbsp;<img src="docs/celular-adquiri.png" alt="Card da Wishlist com as opções de Adquiri este photocard" width="24%">&nbsp;<img src="docs/celular-pedido.png" alt="Página do pedido no celular" width="24%"><br><sub><b>Celular:</b> o Binder, o "Adquiri este photocard" da Wishlist e a página de um pedido.</sub></td>
  </tr>
</table>

<sub>Telas com dados de teste.</sub>

## Tecnologias

| Parte | Tecnologia |
| --- | --- |
| Site | HTML, CSS e JavaScript puros, sem etapa de build |
| Hospedagem | GitHub Pages (branch `main`, pasta `/ (root)`) |
| Contas, banco e fotos | [Supabase](https://supabase.com), na região São Paulo |

## Banco de dados

O banco fica no Supabase (PostgreSQL). Tudo está em [`supabase/schema.sql`](supabase/schema.sql), que pode ser rodado de novo sem apagar dados.

| Tabela | O que guarda |
| --- | --- |
| `cards` | Cada photocard. A coluna `kind` diz o tipo: `compra`, `binder` ou `wishlist`. Compras têm valores, pagamento e chegada; Binder e Wishlist só têm foto, nome e grupo (uma regra do banco impede valores neles). |
| `card_groups` | Os pedidos, com os fretes e a taxa que valem para vários cards |
| `folders` | As pastas do Binder e da Wishlist (`scope`) |
| `stats` | O valor das coleções apagadas em versões antigas, que continua no total |

Os totais do app somam só os cards com `kind = 'compra'`.

## Segurança

- As regras de acesso (RLS) do [`schema.sql`](supabase/schema.sql) limitam cada pessoa aos próprios dados.
- O bucket de fotos é privado, e as fotos são exibidas por links temporários.
- A chave `anon` do [`config.js`](config.js) pode ser pública. **Nunca** coloque a `service_role` no repositório.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| [`index.html`](index.html) | Telas de login e do app (Início, Compras, Binder, Wishlist e Financeiro) e as janelas de cadastro, pedidos, pastas e detalhes |
| [`style.css`](style.css) | Visual (temas claro e escuro) |
| [`app.js`](app.js) | Contas, compras, pedidos, Binder, Wishlist, pastas, fotos, totais e gráficos |
| [`config.js`](config.js) | URL e chave `anon` do Supabase |
| [`icons/`](icons) e [`manifest.webmanifest`](manifest.webmanifest) | Logo, ícone da aba e ícone para instalar o site como app |
| [`supabase/schema.sql`](supabase/schema.sql) | Tabelas, regras de segurança e bucket de fotos (veja [Banco de dados](#banco-de-dados)) |

## Rodar no computador

```bash
git clone https://github.com/renokkj/pop-collection.git
cd pop-collection
python3 -m http.server 8000
```

Depois, abra http://localhost:8000.
