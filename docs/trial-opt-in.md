# Ativação do trial de 7 dias

1. Confirme que o checkout mensal e o webhook de confirmação do Asaas funcionam em produção. O fim do trial não cobra automaticamente: a pessoa escolhe cartão ou Pix e precisa concluir o pagamento.
2. Publique o código com a tela de ativação e execute `supabase-trial-activation.sql` no projeto Supabase correto, em uma janela controlada. A migração habilita `enforcement_enabled` e define `trial_days = 7`.
3. Crie uma conta de teste nova. Antes do clique, confirme `status = 'pending_trial'`, `trial_started_at is null` e `trial_ends_at is null`. Ao clicar, confirme `status = 'trialing'` e término sete dias depois do instante do clique. Um segundo clique ou chamada direta ao RPC não pode renovar o prazo.
4. Em ambiente de teste, simule a expiração em uma conta descartável e confirme que o painel operacional não é carregado e as ações de gravação são recusadas pelo banco. Teste o checkout e a liberação somente após confirmação do webhook. Não altere datas de uma assinatura real para testar.

As assinaturas e trials anteriores à migração não são reiniciados automaticamente. Contas com trial antigo vencido continuarão bloqueadas até pagar; uma cortesia precisa de decisão manual e separada. O bloqueio da interface não apaga dados nem elimina direitos de acesso/exportação: a proteção de escrita continua no banco. Ao fazer rollback da interface, não reexecute migrations antigas que reponham o gatilho de trial na criação da conta.
