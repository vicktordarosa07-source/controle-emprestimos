# Checklist antes de vender o Recebify

Este checklist separa o que foi endurecido no código do que depende de configuração e teste nas contas reais. Não habilite bloqueio de escrita nem cobre clientes até concluir os itens marcados como bloqueadores.

## 1. Segurança e dados

- [ ] Como uma chave Asaas e um token de webhook foram compartilhados anteriormente na conversa, rotacione os dois antes de qualquer cobrança real. Gere credenciais novas no Asaas; atualize os secrets correspondentes na Vercel; atualize o token no cadastro do webhook; faça redeploy; confirme a entrega; só então revogue os antigos. Não cole secrets em chat, issue, print ou arquivo do repositório.
- [ ] Na Vercel, confira que chaves privadas estão definidas só no ambiente necessário (Production, e Preview apenas se realmente usar) e nunca têm prefixo `NEXT_PUBLIC_`.
- [ ] Rode `supabase-prelaunch-audit.sql` no projeto de produção e confira RLS, políticas e grants. A consulta é somente leitura. Investigue tabelas críticas sem RLS e grants diretos inesperados para `anon` ou `authenticated`.
- [ ] Confira que políticas de leitura limitam cada registro ao usuário proprietário; faça um teste controlado com duas contas distintas e sem compartilhar dados reais.
- [ ] Não ative `saas_billing_settings.enforcement_enabled` até que checkout, confirmação, webhook duplicado, atraso, cancelamento e acesso até o fim do período pago tenham sido verificados no Sandbox.
- [ ] Configure Auth > URL Configuration no Supabase para o Site URL de produção e os redirects usados pelo app, incluindo `https://recebify.vercel.app/auth/confirm` e `https://recebify.vercel.app/auth/confirm?next=%2Fauth%2Fredefinir-senha`. Evite liberar domínios de preview indiscriminadamente.
- [ ] Configure SMTP transacional do Supabase para confirmação e recuperação de senha; teste recebimento, expiração e reuso de link. O serviço de e-mail padrão é limitado e não é a configuração recomendada para produção.
- [ ] No Supabase Auth, defina senha mínima de 8 caracteres e ative proteções contra abuso/CAPTCHA ou limites adequados antes de abrir cadastro público.
- [ ] Faça um teste de recuperação de senha de ponta a ponta e valide que usuário sem sessão não consegue abrir a página de troca.
- [ ] Confirme backup e restauração em um ambiente descartável; defina frequência de backup do banco e procedimento de recuperação. Export JSON não substitui backup automático do banco.

## 2. Cobrança e política comercial

- [ ] Mantenha `ASAAS_PLATFORM_ENV=sandbox` durante os testes. Não use `live` apenas para conferir a interface.
- [ ] Teste no Sandbox a criação do checkout mensal, pagamento, webhook, idempotência (mesmo evento entregue duas vezes), pagamento recusado, atraso, cancelamento e retorno do checkout. Confira tanto o estado do Asaas quanto a assinatura no banco e o acesso no app.
- [ ] Confirme o preço final e trial antes de divulgar. O valor mostrado no site depende de `SAAS_STARTER_MONTHLY_BRL`; mudar a variável exige novo deploy e não altera assinaturas já existentes no Asaas.
- [ ] Só habilite `ASAAS_PLATFORM_LIVE_BILLING_ENABLED=true` após revisão final e autorização para abrir cobrança real. O bloqueio por assinatura no Supabase é uma chave separada e também permanece desligado até os testes concluídos.
- [ ] Escreva claramente preço, periodicidade, eventual trial, quando a primeira cobrança ocorre, como cancelar e o que acontece com acesso e dados após cancelamento.
- [ ] Documente atendimento para falha de pagamento, estorno, contestação, pedido de cancelamento e conta bloqueada; monitore os logs de webhooks e falhas de e-mail.

## 3. Apresentação e operação

- [ ] Defina o público inicial e o principal resultado vendido (por exemplo, controle de cobranças parceladas para pequenos credores), sem prometer automações ou integrações que ainda não foram testadas.
- [ ] Confirme o nome legal do operador, canal de suporte, e-mail de contato e domínio definitivo. Esses dados não podem ser inventados; são necessários para publicar páginas confiáveis de Termos, Privacidade e contato.
- [ ] Revise textos de cadastro, tela vazia, preço, cobrança recorrente, privacidade e cancelamento em desktop e celular.
- [ ] Verifique monitoramento/alertas para erros de API, falhas de cron, webhook inválido e aumento de falhas de login. Faça um ensaio de suporte com uma conta de teste.
- [ ] Antes de anunciar, faça um percurso completo com uma conta nova: confirmar e-mail, recuperar senha, cadastrar cobrança, registrar pagamento parcial, exportar dados, cancelar e solicitar exclusão/atendimento.

## Estado conhecido nesta revisão

- A interface e as ações do servidor agora falham fechadas quando não conseguem consultar autorização de escrita; usuários ainda podem consultar e exportar. O enforcement do banco continua deliberadamente separado e não foi ativado.
- O código local não confirma que as migrations, secrets, redirects, SMTP, RLS ou configurações comerciais estejam corretos na conta hospedada. O teste da assinatura real continua pendente por decisão do operador.
- A lista acima não substitui revisão jurídica, fiscal ou de segurança antes de vender para o público.
