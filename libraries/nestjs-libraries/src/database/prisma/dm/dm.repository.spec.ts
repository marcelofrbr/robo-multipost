import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
import { DmRepository } from './dm.repository';

/**
 * O DmRepository acessa duas tabelas (dmConversation e dmMessage). O helper
 * createPrismaRepositoryMock so mocka uma tabela por instancia, entao montamos
 * um mock combinado que expoe model.dmConversation e model.dmMessage. Como o
 * repositorio injeta um unico PrismaRepository (padrao do flows.repository),
 * o mesmo objeto serve para os dois construtores.
 */
function createDmPrismaMock() {
  const conversation = createPrismaRepositoryMock('dmConversation');
  const message = createPrismaRepositoryMock('dmMessage');
  const combined = {
    model: {
      ...conversation.model,
      ...message.model,
    },
  };
  return combined as typeof combined & {
    model: typeof conversation.model & typeof message.model;
  };
}

describe('DmRepository', () => {
  let prisma: ReturnType<typeof createDmPrismaMock>;
  let repo: DmRepository;

  beforeEach(() => {
    prisma = createDmPrismaMock();
    repo = new DmRepository(prisma as any, prisma as any);
  });

  describe('upsertConversation', () => {
    it('deve fazer upsert usando a chave composta integrationId_igSenderId', async () => {
      prisma.model.dmConversation.upsert.mockResolvedValue({ id: 'c1' } as any);

      await repo.upsertConversation({
        organizationId: 'org-1',
        profileId: 'prof-1',
        integrationId: 'int-1',
        igAccountId: 'acc-1',
        igSenderId: 'sender-1',
        igSenderName: 'Fulano',
        source: 'direct_message',
      });

      expect(prisma.model.dmConversation.upsert).toHaveBeenCalledWith({
        where: {
          integrationId_igSenderId: {
            integrationId: 'int-1',
            igSenderId: 'sender-1',
          },
        },
        create: {
          organizationId: 'org-1',
          profileId: 'prof-1',
          integrationId: 'int-1',
          igAccountId: 'acc-1',
          igSenderId: 'sender-1',
          igSenderName: 'Fulano',
          source: 'direct_message',
        },
        update: {
          igSenderName: 'Fulano',
        },
      });
    });

    it('deve omitir profileId no create quando nao for fornecido', async () => {
      prisma.model.dmConversation.upsert.mockResolvedValue({ id: 'c1' } as any);

      await repo.upsertConversation({
        organizationId: 'org-1',
        integrationId: 'int-1',
        igAccountId: 'acc-1',
        igSenderId: 'sender-1',
      });

      expect(prisma.model.dmConversation.upsert).toHaveBeenCalledWith({
        where: {
          integrationId_igSenderId: {
            integrationId: 'int-1',
            igSenderId: 'sender-1',
          },
        },
        create: {
          organizationId: 'org-1',
          integrationId: 'int-1',
          igAccountId: 'acc-1',
          igSenderId: 'sender-1',
        },
        update: {
          igSenderName: undefined,
        },
      });
    });
  });

  describe('setLastInbound', () => {
    it('deve atualizar lastInboundAt com a data atual', async () => {
      prisma.model.dmConversation.update.mockResolvedValue({} as any);

      await repo.setLastInbound('c1');

      expect(prisma.model.dmConversation.update).toHaveBeenCalledTimes(1);
      const arg = prisma.model.dmConversation.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'c1' });
      expect(arg.data.lastInboundAt).toBeInstanceOf(Date);
    });
  });

  describe('appendMessage', () => {
    it('deve criar uma mensagem com metaMid quando fornecido', async () => {
      prisma.model.dmMessage.create.mockResolvedValue({ id: 'm1' } as any);

      await repo.appendMessage('c1', 'user', 'oi', 'mid-1');

      expect(prisma.model.dmMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          role: 'user',
          text: 'oi',
          metaMid: 'mid-1',
        },
      });
    });

    it('deve criar uma mensagem sem metaMid quando nao fornecido', async () => {
      prisma.model.dmMessage.create.mockResolvedValue({ id: 'm1' } as any);

      await repo.appendMessage('c1', 'assistant', 'ola');

      expect(prisma.model.dmMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          role: 'assistant',
          text: 'ola',
          metaMid: undefined,
        },
      });
    });
  });

  describe('findByMetaMid', () => {
    it('deve buscar a mensagem pelo metaMid unico', async () => {
      prisma.model.dmMessage.findUnique.mockResolvedValue(null as any);

      await repo.findByMetaMid('mid-1');

      expect(prisma.model.dmMessage.findUnique).toHaveBeenCalledWith({
        where: { metaMid: 'mid-1' },
      });
    });
  });

  describe('getRecentMessages', () => {
    it('deve buscar mensagens ordenadas por createdAt desc com take limit', async () => {
      prisma.model.dmMessage.findMany.mockResolvedValue([] as any);

      await repo.getRecentMessages('c1', 10);

      expect(prisma.model.dmMessage.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'c1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });

  describe('markHandoff', () => {
    it('deve marcar status HUMAN_HANDOFF com escalatedAt e motivo', async () => {
      prisma.model.dmConversation.update.mockResolvedValue({} as any);

      await repo.markHandoff('c1', 'cliente pediu humano');

      expect(prisma.model.dmConversation.update).toHaveBeenCalledTimes(1);
      const arg = prisma.model.dmConversation.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'c1' });
      expect(arg.data.status).toBe('HUMAN_HANDOFF');
      expect(arg.data.escalationReason).toBe('cliente pediu humano');
      expect(arg.data.escalatedAt).toBeInstanceOf(Date);
    });
  });

  describe('incrementBotReply', () => {
    it('deve incrementar botReplyCount e atualizar lastBotReplyAt', async () => {
      prisma.model.dmConversation.update.mockResolvedValue({} as any);

      await repo.incrementBotReply('c1');

      expect(prisma.model.dmConversation.update).toHaveBeenCalledTimes(1);
      const arg = prisma.model.dmConversation.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'c1' });
      expect(arg.data.botReplyCount).toEqual({ increment: 1 });
      expect(arg.data.lastBotReplyAt).toBeInstanceOf(Date);
    });
  });

  describe('listEscalations', () => {
    it('deve listar conversas em HUMAN_HANDOFF da org', async () => {
      prisma.model.dmConversation.findMany.mockResolvedValue([] as any);

      await repo.listEscalations('org-1');

      expect(prisma.model.dmConversation.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          status: 'HUMAN_HANDOFF',
        },
        orderBy: { escalatedAt: 'desc' },
      });
    });

    it('deve filtrar tambem por profileId quando fornecido', async () => {
      prisma.model.dmConversation.findMany.mockResolvedValue([] as any);

      await repo.listEscalations('org-1', 'prof-1');

      expect(prisma.model.dmConversation.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          status: 'HUMAN_HANDOFF',
          profileId: 'prof-1',
        },
        orderBy: { escalatedAt: 'desc' },
      });
    });
  });

  describe('closeConversation', () => {
    it('deve atualizar status para CLOSED', async () => {
      prisma.model.dmConversation.update.mockResolvedValue({} as any);

      await repo.closeConversation('c1');

      expect(prisma.model.dmConversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'CLOSED' },
      });
    });
  });
});
