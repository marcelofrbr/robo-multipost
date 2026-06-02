import { Injectable, Logger } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { DmConversationStatus } from '@prisma/client';
import { FlowsRepository } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.repository';
import { DmRepository } from '@gitroom/nestjs-libraries/database/prisma/dm/dm.repository';
import { DmRateLimitService } from '@gitroom/nestjs-libraries/database/prisma/dm/dm-rate-limit.service';

interface IncomingDirectMessagePayload {
  integrationId: string;
  organizationId: string;
  profileId?: string;
  igAccountId: string;
  igSenderId: string;
  igSenderName?: string;
  igMessageId: string;
  messageText: string;
}

@Injectable()
export class DmFlowService {
  private readonly _logger = new Logger(DmFlowService.name);

  constructor(
    private _flowsRepository: FlowsRepository,
    private _dmRepository: DmRepository,
    private _rateLimit: DmRateLimitService,
    private _temporalService: TemporalService
  ) {}

  async handleIncomingDirectMessage(
    payload: IncomingDirectMessagePayload
  ): Promise<void> {
    // 1) KILL-SWITCH: so prossegue se houver um Flow ACTIVE com trigger
    // 'direct_message' para esta integration. Sem ele, no-op total.
    const activeFlows =
      await this._flowsRepository.getActiveFlowsForIntegration(
        payload.integrationId
      );
    const hasDmFlow = activeFlows.some(
      (flow) => this.getTriggerType(flow) === 'direct_message'
    );
    if (!hasDmFlow) {
      return;
    }

    // 2) IDEMPOTENCIA: se ja registramos esta metaMid, ignora.
    const existing = await this._dmRepository.findByMetaMid(
      payload.igMessageId
    );
    if (existing) {
      return;
    }

    // 3) Upsert da conversa + registra o inbound.
    const conversation = await this._dmRepository.upsertConversation({
      organizationId: payload.organizationId,
      profileId: payload.profileId,
      integrationId: payload.integrationId,
      igAccountId: payload.igAccountId,
      igSenderId: payload.igSenderId,
      igSenderName: payload.igSenderName,
      source: 'direct_message',
    });
    await this._dmRepository.setLastInbound(conversation.id);
    await this._dmRepository.appendMessage(
      conversation.id,
      'user',
      payload.messageText,
      payload.igMessageId
    );

    // 4) Se um humano assumiu (HUMAN_HANDOFF), nao enfileira o bot.
    //    SOMENTE HUMAN_HANDOFF bloqueia: registra o inbound e nao enfileira.
    if (conversation.status === DmConversationStatus.HUMAN_HANDOFF) {
      this._logger.log(
        `DM em HUMAN_HANDOFF (conversa ${conversation.id}) inbound registrado, bot nao enfileirado`
      );
      return;
    }

    // 4.1) Se a conversa estava CLOSED e a pessoa voltou a falar, REATIVAR
    //      para BOT_ACTIVE e seguir o fluxo normal (enfileira).
    if (conversation.status === DmConversationStatus.CLOSED) {
      await this._dmRepository.reactivate(conversation.id);
      this._logger.log(
        `DM reativada (conversa ${conversation.id} estava CLOSED), bot enfileirado`
      );
    }

    // 4.2) Rate limit por (integracao, remetente), aplicado UMA UNICA VEZ no
    //       intake. Fica aqui (e nao na activity sendDmReply) porque o Temporal
    //       re-tenta a activity e nao queremos consumir cota em cada retry. O
    //       inbound ja foi registrado acima; apenas nao enfileiramos o bot.
    if (
      !(await this._rateLimit.allow(payload.integrationId, payload.igSenderId))
    ) {
      this._logger.warn(
        `DM rate limit atingido para integration=${payload.integrationId} sender=${payload.igSenderId} inbound registrado, bot nao enfileirado`
      );
      return;
    }

    // 5) Enfileira o bot via Temporal.
    const temporalClient = this._temporalService.client.getRawClient();
    if (!temporalClient) {
      this._logger.error(
        `Temporal client indisponivel orchestrator offline? DM da conversa ${conversation.id} nao enfileirado`
      );
      return;
    }

    const workflowId =
      'dmbot-' + conversation.id + '-' + payload.igMessageId;

    await temporalClient.workflow.start('dmBotReplyWorkflow', {
      taskQueue: 'main',
      workflowId,
      memo: {
        conversationId: conversation.id,
        integrationId: payload.integrationId,
      },
      args: [
        {
          conversationId: conversation.id,
          integrationId: payload.integrationId,
          organizationId: payload.organizationId,
          profileId: payload.profileId,
          igAccountId: payload.igAccountId,
          igSenderId: payload.igSenderId,
        },
      ],
    });
  }

  async listEscalations(orgId: string, profileId?: string) {
    return this._dmRepository.listEscalations(orgId, profileId);
  }

  async resolveConversation(orgId: string, conversationId: string) {
    return this._dmRepository.closeConversationForOrg(conversationId, orgId);
  }

  private getTriggerType(flow: {
    nodes?: Array<{ type: string; label?: string | null; data: string | null }>;
  }): string | undefined {
    const trigger = flow.nodes?.find((n) => n.type === 'TRIGGER');
    if (trigger?.label === 'direct_message') return 'direct_message';
    if (trigger?.data) {
      try {
        const parsed = JSON.parse(trigger.data);
        if (parsed?.triggerType) return parsed.triggerType;
      } catch {
        // ignora data malformada
      }
    }
    return trigger?.label ?? undefined;
  }
}
