# Binder de Photocards

App para controlar photocards: cadastro com foto opcional, pagamento (preço e frete), chegada e coleção, com o total gasto.
Cada pessoa cria a própria conta e só vê os próprios cards.

- **Site:** arquivos estáticos (HTML, CSS e JS), hospedados no GitHub Pages
- **Contas, dados e fotos:** [Supabase](https://supabase.com) (plano gratuito)

## Como funciona

1. **Cadastro:** nome, preço e frete. O total (preço + frete) é calculado sozinho. A foto é opcional.
2. **Pagamento:** marque "Preço pago" e "Frete pago". Enquanto faltar algo, o app mostra quanto falta pagar.
3. **Chegada:** com tudo pago, o card vai para esta aba. Clique em "Chegou ✓".
4. **Coleção:** guarda os cards que já chegaram. O botão "Apagar coleção" libera espaço no banco, e o valor gasto continua somado no total.

## Passo a passo para colocar no ar

### 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e clique em **New project**.
2. Abra **SQL Editor**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   Esse passo cria as tabelas, as regras de segurança (cada usuário só acessa os próprios dados) e o bucket de fotos.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. Cole os dois valores no arquivo [`config.js`](config.js).

> A chave **anon** pode ficar pública no GitHub. Quem protege os dados são as regras do `schema.sql`.
> Nunca coloque a chave **service_role** no projeto.

### 2. Publicar no GitHub Pages

1. Envie os arquivos para um repositório no GitHub.
2. No repositório, vá em **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**, depois a branch `main` e a pasta `/ (root)`, e salve.
4. Em cerca de 1 minuto o site fica disponível em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

### 3. Ajustar os links de e-mail no Supabase

Em **Authentication → URL Configuration**:

- **Site URL:** o endereço do seu GitHub Pages (`https://SEU-USUARIO.github.io/NOME-DO-REPO/`)
- **Redirect URLs:** adicione o mesmo endereço

Assim, os links de confirmação de conta e de "Esqueci minha senha" voltam para o seu site.

> Por padrão, o Supabase pede que cada pessoa confirme o e-mail antes de entrar.
> Para desligar isso, desative **Confirm email** em **Authentication → Sign In / Providers → Email**.
> O envio de e-mails do plano gratuito tem limite por hora. Para muitos usuários, configure um SMTP próprio em **Authentication → Emails**.

## Rodar no computador

Qualquer servidor estático funciona. Por exemplo:

```bash
python3 -m http.server 8000
```

Depois abra http://localhost:8000 (e adicione esse endereço em **Redirect URLs** no Supabase se for testar o cadastro).

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html` | Telas de login, cadastro e do app |
| `style.css` | Visual (tema claro e escuro automáticos) |
| `app.js` | Lógica: contas, cards, fotos e totais |
| `config.js` | URL e chave anon do seu Supabase |
| `supabase/schema.sql` | Tabelas, regras de segurança e bucket de fotos |
