import { proxyActivities } from '@temporalio/workflow';
import type { FlowActivity } from '@gitroom/orchestrator/activities/flow.activity';

// Geracao e idempotente: pode re-tentar sem efeito colateral externo.
const { generateDmReply } = proxyActivities<FlowActivity>({
  startToCloseTimeout: '5 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: '10 seconds',
  },
});

// Envio NAO pode re-tentar: a Meta nao tem idempotencia de DM, entao um retry
// apos um envio bem-sucedido (mas com falha posterior na activity) mandaria
// DM duplicado. maximumAttempts: 1 garante no maximo uma tentativa de envio.
const { sendDmReply, escalateDmToHuman } = proxyActivities<FlowActivity>({
  startToCloseTimeout: '5 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 1,
  },
});

export interface DmBotReplyInput {
  conversationId: string;
  integrationId: string;
  organizationId: string;
  profileId?: string;
  igAccountId: string;
  igSenderId: string;
}

/**
 * Workflow do bot de atendimento por DM. Enfileirado pelo DmFlowService a
 * cada inbound de uma conversa BOT_ACTIVE. A activity generateDmReply deriva
 * o userMessage da ultima mensagem do usuario no historico, entao o workflow
 * so precisa passar os ids.
 */
export async function dmBotReplyWorkflow(input: DmBotReplyInput) {
  const result = await generateDmReply({
    conversationId: input.conversationId,
    orgId: input.organizationId,
    profileId: input.profileId,
    integrationId: input.integrationId,
  });

  if (result.escalate) {
    await escalateDmToHuman({
      conversationId: input.conversationId,
      orgId: input.organizationId,
      integrationId: input.integrationId,
      igSenderId: input.igSenderId,
      reason: result.reason,
    });
    return;
  }

  await sendDmReply({
    conversationId: input.conversationId,
    orgId: input.organizationId,
    integrationId: input.integrationId,
    igSenderId: input.igSenderId,
    reply: result.reply,
  });
}
