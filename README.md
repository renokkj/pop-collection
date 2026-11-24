<div align="center">

# Pop Collection

Controle os pagamentos, a chegada e a coleção dos seus photocards.

[![Abrir o app](https://img.shields.io/badge/abrir_o_app-5b3fd6?style=for-the-badge)](https://renokkj.github.io/pop-collection/)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-222222?logo=githubpages&logoColor=white)

<br>

<img src="docs/tela-computador.png" alt="Tela inicial do Pop Collection no computador" width="68%">&nbsp;
<img src="docs/tela-celular.png" alt="Tela inicial do Pop Collection no celular" width="24%">

<sub>Telas com dados de teste.</sub>

</div>

## Sobre o projeto

Criei o Pop Collection para resolver um problema meu: acompanhar quanto já paguei, o que falta pagar e quais photocards ainda estão a caminho. Foi o primeiro projeto que idealizei do zero, da ideia ao app publicado.

## O que o app faz

- **Contas individuais:** cada pessoa só vê os próprios cards.
- **Cadastro com foto:** pelo botão "+ Cadastrar Photocard", que abre uma janela com nome, vendedor, categoria, preço e fretes. A foto e o vendedor são opcionais.
- **Categorias de compra:** Individual ou CEG, Nacional ou Internacional. O formulário mostra só os fretes e a taxa de importação (opcional) de cada categoria. Na CEG, você informa só a sua parte do que é dividido.
- **Edição e exclusão:** corrija nome, vendedor, categoria, valores ou foto depois do cadastro, ou exclua um card.
- **Controle financeiro:** mostra o total gasto, o que já foi pago e o que falta pagar.
- **Três abas:** Pagamento, Chegada e Coleção, cada uma com a contagem de cards.
- **Chegada:** separa os cards quitados que ainda estão a caminho.
- **Recuperar a senha** pelo link "Esqueci minha senha".
- **Tema claro e escuro**, conforme o dispositivo.

## Como funciona

O app abre nas abas **Pagamento**, **Chegada** e **Coleção**. O cadastro fica no botão **+ Cadastrar Photocard**, ao lado das abas.

```mermaid
flowchart LR
    A[+ Cadastrar Photocard] --> B[Pagamento]
    B -->|tudo pago| C[Chegada]
    C -->|Chegou ✓| D[Coleção]
```

1. **Cadastrar:** clique em "+ Cadastrar Photocard", escolha a categoria e preencha os dados do card. O total (preço, fretes e taxa) é calculado sozinho, e o card entra na aba Pagamento.
2. **Pagamento:** marque cada valor pago (preço, fretes e taxa). O app mostra quanto ainda falta.
3. **Chegada:** com tudo pago, o card vem para cá. Quando receber, clique em "Chegou ✓". Se marcou algo errado, "Voltar p/ pagamento" desfaz.
4. **Coleção:** guarda os cards recebidos ("Ainda não chegou" devolve o card para a Chegada). "Apagar coleção" remove esses cards e suas fotos, mas mantém o valor no total gasto.

## Tecnologias

| Parte | Tecnologia |
| --- | --- |
| Site | HTML, CSS e JavaScript puros, sem etapa de build |
| Hospedagem | GitHub Pages (branch `main`, pasta `/ (root)`) |
| Contas, banco e fotos | [Supabase](https://supabase.com), na região São Paulo |

## Segurança

- As regras de acesso (RLS) do [`schema.sql`](supabase/schema.sql) limitam cada pessoa aos próprios dados.
- O bucket de fotos é privado, e as fotos são exibidas por links temporários.
- A chave `anon` do [`config.js`](config.js) pode ser pública. **Nunca** coloque a `service_role` no repositório.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| [`index.html`](index.html) | Telas de login e do app, e a janela de cadastro de photocard |
| [`style.css`](style.css) | Visual (temas claro e escuro) |
| [`app.js`](app.js) | Contas, cards, fotos e totais |
| [`config.js`](config.js) | URL e chave `anon` do Supabase |
| [`supabase/schema.sql`](supabase/schema.sql) | Tabelas, regras de segurança e bucket de fotos |

## Rodar no computador

```bash
git clone https://github.com/renokkj/pop-collection.git
cd pop-collection
python3 -m http.server 8000
```

Depois, abra http://localhost:8000.
