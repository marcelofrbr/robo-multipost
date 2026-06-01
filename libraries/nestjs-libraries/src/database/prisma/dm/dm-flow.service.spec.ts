import { DmFlowService } from './dm-flow.service';
import { FlowsRepository } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.repository';
import { DmRepository } from '@gitroom/nestjs-libraries/database/prisma/dm/dm.repository';
import { DmRateLimitService } from '@gitroom/nestjs-libraries/database/prisma/dm/dm-rate-limit.service';
import { TemporalService } from 'nestjs-temporal-core';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MockProxy } from 'jest-mock-extended';

describe('DmFlowService', () => {
  let service: DmFlowService;
  let flowsRepository: MockProxy<FlowsRepository> & FlowsRepository;
  let dmRepository: MockProxy<DmRepository> & DmRepository;
  let rateLimit: MockProxy<DmRateLimitService> & DmRateLimitService;
  let temporalService: MockProxy<TemporalService> & TemporalService;
  let workflowStart: jest.Mock;

  const dmFlow = {
    id: 'flow-1',
    nodes: [
      {
        type: 'TRIGGER',
        label: 'direct_message',
        data: null as string | null,
      },
    ],
  };

  const basePayload = {
    integrationId: 'int-1',
    organizationId: 'org-1',
    profileId: 'prof-1',
    igAccountId: 'iga-1',
    igSenderId: 'sender-1',
    igSenderName: 'Fulano',
    igMessageId: 'mid-abcdef12345678',
    messageText: 'ola, tudo bem?',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    flowsRepository = createMock<FlowsRepository>();
    dmRepository = createMock<DmRepository>();
    rateLimit = createMock<DmRateLimitService>();
    // Por padrao o rate limit permite — casos especificos sobrescrevem.
    rateLimit.allow.mockResolvedValue(true);
    temporalService = createMock<TemporalService>();
    workflowStart = jest.fn();
    (temporalService as any).client = {
      getRawClient: jest
        .fn()
        .mockReturnValue({ workflow: { start: workflowStart } }),
    };
    service = new DmFlowService(
      flowsRepository,
      dmRepository,
      rateLimit,
      temporalService
    );
  });

  describe('handleIncomingDirectMessage', () => {
    it('deve ser no-op quando nao ha flow direct_message ativo', async () => {
      // ARRANGE
      flowsRepository.getActiveFlowsForIntegration.mockResolvedValue([
        {
          id: 'flow-2',
          nodes: [
            {
              type: 'TRIGGER',
              label: 'comment_on_post',
              data: null as string | null,
            },
          ],
        },
      ] as any);

      // ACT
      await service.handleIncomingDirectMessage(basePayload);

      // ASSERT
      expect(dmRepository.findByMetaMid).not.toHaveBeenCalled();
      expect(dmRepository.upsertConversation).not.toHaveBeenCalled();
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('deve ser no-op apos findByMetaMid quando metaMid ja existe', async () => {
      // ARRANGE
      flowsRepository.getActiveFlowsForIntegration.mockResolvedValue([
        dmFlow,
      ] as any);
      dmRepository.findByMetaMid.mockResolvedValue({ id: 'msg-1' } as any);

      // ACT
      await service.handleIncomingDirectMessage(basePayload);

      // ASSERT
      expect(dmRepository.findByMetaMid).toHaveBeenCalledWith(
        basePayload.igMessageId
      );
      expect(dmRepository.upsertConversation).not.toHaveBeenCalled();
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('deve registrar inbound mas NAO enfileirar quando conversa em HUMAN_HANDOFF', async () => {
      // ARRANGE
      flowsRepository.getActiveFlowsForIntegration.mockResolvedValue([
        dmFlow,
      ] as any);
      dmRepository.findByMetaMid.mockResolvedValue(null as any);
      dmRepository.upsertConversation.mockResolvedValue({
        id: 'conv-1',
        status: 'HUMAN_HANDOFF',
      } as any);

      // ACT
      await service.handleIncomingDirectMessage(basePayload);

      // ASSERT
      expect(dmRepository.upsertConversation).toHaveBeenCalled();
      expect(dmRepository.setLastInbound).toHaveBeenCalledWith('conv-1');
      expect(dmRepository.appendMessage).toHaveBeenCalledWith(
        'conv-1',
        'user',
        basePayload.messageText,
        basePayload.igMessageId
      );
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('deve fazer upsert, registrar inbound e enfileirar dmBotReplyWorkflow no caminho feliz', async () => {
      // ARRANGE
      flowsRepository.getActiveFlowsForIntegration.mockResolvedValue([
        dmFlow,
      ] as any);
      dmRepository.findByMetaMid.mockResolvedValue(null as any);
      dmRepository.upsertConversation.mockResolvedValue({
        id: 'conv-1',
        status: 'BOT_ACTIVE',
      } as any);

      // ACT
      await service.handleIncomingDirectMessage(basePayload);

      // ASSERT
      expect(dmRepository.upsertConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          integrationId: 'int-1',
          igSenderId: 'sender-1',
          source: 'direct_message',
        })
      );
      expect(dmRepository.setLastInbound).toHaveBeenCalledWith('conv-1');
      expect(dmRepository.appendMessage).toHaveBeenCalledWith(
        'conv-1',
        'user',
        basePayload.messageText,
        basePayload.igMessageId
      );
      expect(workflowStart).toHaveBeenCalledTimes(1);
      expect(workflowStart).toHaveBeenCalledWith(
        'dmBotReplyWorkflow',
        expect.objectContaining({
          taskQueue: 'main',
          workflowId: `dmbot-conv-1-${basePayload.igMessageId}`,
          memo: {
            conversationId: 'conv-1',
            integrationId: 'int-1',
          },
          args: [
            expect.objectContaining({
              conversationId: 'conv-1',
              integrationId: 'int-1',
              organizationId: 'org-1',
              igSenderId: 'sender-1',
            }),
          ],
        })
      );
    });

    it('deve registrar inbound mas NAO enfileirar quando rate limit estourado', async () => {
      // ARRANGE
      flowsRepository.getActiveFlowsForIntegration.mockResolvedValue([
        dmFlow,
      ] as any);
      dmRepository.findByMetaMid.mockResolvedValue(null as any);
      dmRepository.upsertConversation.mockResolvedValue({
        id: 'conv-1',
        status: 'BOT_ACTIVE',
      } as any);
      rateLimit.allow.mockResolvedValue(false);

      // ACT
      await service.handleIncomingDirectMessage(basePayload);

      // ASSERT
      expect(dmRepository.appendMessage).toHaveBeenCalledWith(
        'conv-1',
        'user',
        basePayload.messageText,
        basePayload.igMessageId
      );
      expect(rateLimit.allow).toHaveBeenCalledWith('int-1', 'sender-1');
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('deve reativar e enfileirar quando a conversa estava CLOSED', async () => {
      // ARRANGE
      flowsRepository.getActiveFlowsForIntegration.mockResolvedValue([
        dmFlow,
      ] as any);
      dmRepository.findByMetaMid.mockResolvedValue(null as any);
      dmRepository.upsertConversation.mockResolvedValue({
        id: 'conv-1',
        status: 'CLOSED',
      } as any);

      // ACT
      await service.handleIncomingDirectMessage(basePayload);

      // ASSERT
      expect(dmRepository.reactivate).toHaveBeenCalledWith('conv-1');
      expect(workflowStart).toHaveBeenCalledTimes(1);
    });
  });
});
