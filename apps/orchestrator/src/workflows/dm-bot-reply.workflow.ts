import { proxyActivities } from '@temporalio/workflow';
import type { FlowActivity } from '@gitroom/orchestrator/activities/flow.activity';

const { generateDmReply, sendDmReply, escalateDmToHuman } =
  proxyActivities<FlowActivity>({
    startToCloseTimeout: '5 minute',
    taskQueue: 'main',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 2,
      initialInterval: '10 seconds',
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
