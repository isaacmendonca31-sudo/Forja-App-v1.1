# FORJA — Diário de treino (PWA)

App de registro e acompanhamento de treinos de musculação (hipertrofia): ficha editável, registro série a série, cronômetro de descanso, histórico, evolução, biblioteca de exercícios, backup e sincronização opcional (Supabase). HTML + CSS + JavaScript puro, **sem dependências**, funciona offline e é instalável no Android.

## Experiência integrada (1.2.1)
- Resumo semanal com dias concluídos e acesso direto ao treino planejado.
- Painel de evolução com filtros por 30 dias, 90 dias ou todo o histórico, volume semanal, consistência, séries por grupo muscular e exercícios em destaque.
- Análises calculadas localmente, sem carregar Python ou dados de treino para um serviço externo.
- Na primeira abertura, tenta converter os treinos da versão antiga preservados neste navegador. Backups JSON exportados pelo app antigo também podem ser importados em Ajustes; a importação mescla o histórico e mantém a ficha atual.

## Rodar localmente
```bash
python3 -m http.server 8080      # ou: npm start
# abra http://localhost:8080
```
Service Worker exige `localhost` ou HTTPS. Use o botão **Instalar** no cabeçalho quando o navegador disponibilizar o prompt; caso contrário, siga a orientação do app no menu do navegador. Abrir `index.html` diretamente como `file://` não permite instalar a PWA.

## Publicar (hospedagem estática)
Qualquer uma serve: Netlify, Cloudflare Pages, Vercel, GitHub Pages. Prefira as que aceitam cabeçalhos HTTP (`_headers` já incluído). Veja `docs/DEPLOY.md`.

## Estrutura
```
index.html            casca do app + CSP
sw.js                 service worker (offline)
manifest.webmanifest  instalação PWA
css/style.css         identidade visual e componentes
js/app.js             roteador, SW, erros globais
js/store.js           armazenamento local, registros, lápides
js/validate.js        saneamento (allow-list) de todo dado externo
js/suggest.js         progressão, estagnação, trocas, "máquina ocupada" (funções puras)
js/sync.js            login + sincronização Supabase (opcional)
js/backup.js          exportar/importar (AES-GCM opcional)
js/views/*            telas
js/data/*             biblioteca de exercícios e ficha padrão
supabase/schema.sql   tabela + RLS + trigger de conflito
tests/                testes automatizados (node --test)
docs/                 SECURITY, UX, PRIVACY, DEPLOY
```

## Testes
```bash
npm run check    # consistência do pré-cache + 26 testes unitários
```

## Ativar sincronização (opcional, futuro: você + namorada)
1. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor.
2. Authentication → Providers → Email: **desative "Allow new users to sign up"**, ative confirmação de e-mail; crie as 2 contas em Authentication → Users.
3. Preencha `js/config.js` com `SUPABASE_URL` e a chave **anon/publishable** (nunca a `service_role`).
4. Publique de novo e incremente `VERSION` em `sw.js` e `js/version.js`.
5. Em Ajustes → Conta, entre; o app pergunta se quer enviar os dados locais.

Cada conta só enxerga as próprias linhas (RLS). Conflitos: vence o registro mais recente; exclusões sincronizam via lápides.

## Ao publicar nova versão
Altere `VERSION` em `sw.js` e `js/version.js`; `node scripts/check-precache.mjs` valida. Usuários veem "Nova versão disponível → Atualizar" (nunca recarrega no meio do treino).

## Pontos a confirmar com você
- Os asteriscos em *Leg press 45°\** e *Cadeira extensora\** da ficha não tinham legenda; foram mantidos como observação "Marcado com * na ficha original" (editável).
- Sincronização foi escrita contra a API do Supabase mas **não testada contra um projeto real** (sem credenciais aqui). Teste com uma conta antes de confiar nela; faça backup antes.
