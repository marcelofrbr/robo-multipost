// Evita carregar integration.manager -> nostr.provider -> nostr-tools (ESM) ao
// importar FlowsService transitivamente; o service e totalmente mockado aqui.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { PublicFlowsController } from './public.flows.controller';
import { HttpException } from '@nestjs/common';
import { FlowStatus } from '@prisma/client';

const makeFlowsService = () => ({
  quickCreateFlow: jest.fn(),
  quickUpdateFlow: jest.fn(),
  getFlows: jest.fn(),
  getFlow: jest.fn(),
  updateFlowStatus: jest.fn(),
  deleteFlow: jest.fn(),
  getExecutions: jest.fn(),
  getExecution: jest.fn(),
  getInstagramPostsByIntegration: jest.fn(),
  getInstagramStoriesByIntegration: jest.fn(),
  checkIntegrationWebhook: jest.fn(),
  createOrUpdateDirectMessageBotFlow: jest.fn(),
  assertIntegrationAccess: jest.fn(),
});

const makeDmFlowService = () => ({
  listEscalations: jest.fn(),
  resolveConversation: jest.fn(),
});

const org = { id: 'org-1' } as any;

describe('PublicFlowsController', () => {
  let controller: PublicFlowsController;
  let flowsService: ReturnType<typeof makeFlowsService>;
  let dmFlowService: ReturnType<typeof makeDmFlowService>;

  beforeEach(() => {
    flowsService = makeFlowsService();
    dmFlowService = makeDmFlowService();
    controller = new PublicFlowsController(
      flowsService as any,
      dmFlowService as any
    );
  });

  describe('createFlow', () => {
    it('deve delegar para quickCreateFlow com default postMode next_publication', async () => {
      flowsService.quickCreateFlow.mockResolvedValue({ id: 'flow-1' });
      await controller.createFlow(org, undefined, undefined, {
        name: 'Receita',
        integrationId: 'int-1',
        dmMessage: 'Aqui esta o link',
      } as any);
      expect(flowsService.quickCreateFlow).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          integrationId: 'int-1',
          postMode: 'next_publication',
        }),
        undefined
      );
    });

    it('deve respeitar postMode explicito quando informado', async () => {
      flowsService.quickCreateFlow.mockResolvedValue({ id: 'flow-1' });
      await controller.createFlow(org, undefined, undefined, {
        name: 'X',
        integrationId: 'int-1',
        postMode: 'all',
      } as any);
      expect(flowsService.quickCreateFlow).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ postMode: 'all' }),
        undefined
      );
    });

    it('chave por-perfil: cria escopado ao proprio perfil', async () => {
      flowsService.quickCreateFlow.mockResolvedValue({ id: 'flow-1' });
      await controller.createFlow(org, 'perfil-A', undefined, {
        name: 'X',
        integrationId: 'int-1',
      } as any);
      expect(flowsService.quickCreateFlow).toHaveBeenCalledWith(
        'org-1',
        expect.any(Object),
        'perfil-A'
      );
    });

    it('chave de org: pode escopar a criacao a um perfil via ?profileId', async () => {
      flowsService.quickCreateFlow.mockResolvedValue({ id: 'flow-1' });
      await controller.createFlow(org, undefined, 'perfil-B', {
        name: 'X',
        integrationId: 'int-1',
      } as any);
      expect(flowsService.quickCreateFlow).toHaveBeenCalledWith(
        'org-1',
        expect.any(Object),
        'perfil-B'
      );
    });

    it('chave por-perfil: lanca 403 ao criar para outro profileId', async () => {
      const err: any = await controller
        .createFlow(org, 'perfil-A', 'perfil-B', {
          name: 'X',
          integrationId: 'int-1',
        } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(403);
      expect(flowsService.quickCreateFlow).not.toHaveBeenCalled();
    });
  });

  describe('listFlows', () => {
    it('chave de org: retorna todos os flows', async () => {
      flowsService.getFlows.mockResolvedValue([
        { id: 'f1', integrationId: 'int-1' },
        { id: 'f2', integrationId: 'int-2' },
      ]);
      const result = await controller.listFlows(org, undefined, undefined, undefined);
      expect(flowsService.getFlows).toHaveBeenCalledWith('org-1', undefined);
      expect(result).toHaveLength(2);
    });

    it('deve filtrar por integrationId quando informado', async () => {
      flowsService.getFlows.mockResolvedValue([
        { id: 'f1', integrationId: 'int-1' },
        { id: 'f2', integrationId: 'int-2' },
      ]);
      const result = await controller.listFlows(org, undefined, undefined, 'int-2');
      expect(result).toEqual([{ id: 'f2', integrationId: 'int-2' }]);
    });

    it('chave por-perfil: forca o proprio profileId', async () => {
      flowsService.getFlows.mockResolvedValue([]);
      await controller.listFlows(org, 'perfil-A', undefined, undefined);
      expect(flowsService.getFlows).toHaveBeenCalledWith('org-1', 'perfil-A');
    });

    it('chave por-perfil: lanca 403 ao pedir outro profileId', async () => {
      const err: any = await controller
        .listFlows(org, 'perfil-A', 'perfil-B', undefined)
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(403);
      expect(flowsService.getFlows).not.toHaveBeenCalled();
    });
  });

  describe('getFlow', () => {
    it('deve delegar para getFlow com escopo de perfil', async () => {
      flowsService.getFlow.mockResolvedValue({ id: 'f1' });
      await controller.getFlow(org, 'perfil-A', 'f1', undefined);
      expect(flowsService.getFlow).toHaveBeenCalledWith('org-1', 'f1', 'perfil-A');
    });

    it('chave por-perfil: lanca 403 ao pedir outro profileId', async () => {
      const err: any = await controller
        .getFlow(org, 'perfil-A', 'f1', 'perfil-B')
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(403);
      expect(flowsService.getFlow).not.toHaveBeenCalled();
    });
  });

  describe('updateFlow', () => {
    it('deve delegar para quickUpdateFlow com escopo de perfil', async () => {
      flowsService.quickUpdateFlow.mockResolvedValue({ id: 'f1' });
      await controller.updateFlow(org, undefined, 'f1', undefined, {
        name: 'Novo nome',
        integrationId: 'int-1',
      } as any);
      expect(flowsService.quickUpdateFlow).toHaveBeenCalledWith(
        'org-1',
        'f1',
        expect.objectContaining({ name: 'Novo nome' }),
        undefined
      );
    });

    it('chave por-perfil: lanca 403 ao editar para outro profileId', async () => {
      const err: any = await controller
        .updateFlow(org, 'perfil-A', 'f1', 'perfil-B', { name: 'X', integrationId: 'int-1' } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(403);
      expect(flowsService.quickUpdateFlow).not.toHaveBeenCalled();
    });
  });

  describe('updateFlowStatus', () => {
    it('deve delegar status para o service', async () => {
      flowsService.updateFlowStatus.mockResolvedValue({ id: 'f1' });
      await controller.updateFlowStatus(org, undefined, 'f1', undefined, {
        status: FlowStatus.PAUSED,
      });
      expect(flowsService.updateFlowStatus).toHaveBeenCalledWith(
        'org-1',
        'f1',
        FlowStatus.PAUSED,
        undefined
      );
    });
  });

  describe('deleteFlow', () => {
    it('chave por-perfil: delega delete com o proprio profileId', async () => {
      flowsService.deleteFlow.mockResolvedValue({ id: 'f1' });
      await controller.deleteFlow(org, 'perfil-A', 'f1', undefined);
      expect(flowsService.deleteFlow).toHaveBeenCalledWith('org-1', 'f1', 'perfil-A');
    });
  });
  describe('executions', () => {
    it('lista execucoes do flow com paginacao e escopo de perfil', async () => {
      flowsService.getFlow.mockResolvedValue({ id: 'flow-1' });
      flowsService.getExecutions.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.listExecutions(org, 'profile-1', 'flow-1', '2', '10');

      expect(flowsService.getFlow).toHaveBeenCalledWith('org-1', 'flow-1', 'profile-1');
      expect(flowsService.getExecutions).toHaveBeenCalledWith('org-1', 'flow-1', 2, 10);

      await controller.listExecutions(org, 'profile-1', 'flow-1', '-3', '9999');
      expect(flowsService.getExecutions).toHaveBeenLastCalledWith('org-1', 'flow-1', 1, 100);
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('lanca 404 quando o flow nao pertence ao escopo', async () => {
      flowsService.getFlow.mockResolvedValue(null);

      await expect(
        controller.listExecutions(org, 'profile-1', 'flow-x')
      ).rejects.toMatchObject({ status: 404 });
      expect(flowsService.getExecutions).not.toHaveBeenCalled();
    });

    it('detalha uma execucao apos validar o flow', async () => {
      flowsService.getFlow.mockResolvedValue({ id: 'flow-1' });
      flowsService.getExecution.mockResolvedValue({ id: 'exec-1' });

      const result = await controller.getExecution(org, undefined, 'flow-1', 'exec-1');

      expect(flowsService.getExecution).toHaveBeenCalledWith('org-1', 'exec-1', 'flow-1');
      expect(result).toEqual({ id: 'exec-1' });
    });

    it('lanca 404 quando a execucao nao pertence ao flow', async () => {
      flowsService.getFlow.mockResolvedValue({ id: 'flow-1' });
      flowsService.getExecution.mockResolvedValue(null);

      await expect(
        controller.getExecution(org, undefined, 'flow-1', 'exec-de-outro-flow')
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('integration posts/stories/webhook', () => {
    it('lista posts do instagram da integracao com escopo de perfil', async () => {
      flowsService.getInstagramPostsByIntegration.mockResolvedValue([{ id: 'm1' }]);

      const result = await controller.listIntegrationPosts(org, 'profile-1', 'int-1', undefined, 'abc', '500');

      expect(flowsService.getInstagramPostsByIntegration).toHaveBeenCalledWith('org-1', 'int-1', 'abc', 50, 'profile-1');
      expect(result).toEqual([{ id: 'm1' }]);
    });

    it('lista stories da integracao', async () => {
      flowsService.getInstagramStoriesByIntegration.mockResolvedValue([]);

      await controller.listIntegrationStories(org, undefined, 'int-1', 'profile-9');

      expect(flowsService.getInstagramStoriesByIntegration).toHaveBeenCalledWith('org-1', 'int-1', 'profile-9');
    });

    it('chave por-perfil: lanca 403 ao pedir posts de outro perfil', async () => {
      await expect(
        controller.listIntegrationPosts(org, 'profile-1', 'int-1', 'profile-2')
      ).rejects.toMatchObject({ status: 403 });
    });

    it('retorna o status do webhook da integracao', async () => {
      flowsService.checkIntegrationWebhook.mockResolvedValue({ ok: true });

      const result = await controller.webhookStatus(org, 'profile-1', 'int-1');

      expect(flowsService.assertIntegrationAccess).toHaveBeenCalledWith('org-1', 'int-1', 'profile-1');
      expect(flowsService.checkIntegrationWebhook).toHaveBeenCalledWith('org-1', 'int-1');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('dm', () => {
    it('configura o bot de dm com escopo de perfil', async () => {
      flowsService.createOrUpdateDirectMessageBotFlow.mockResolvedValue({ id: 'flow-dm' });

      const result = await controller.configureDmBot(org, 'profile-1', {
        integrationId: 'int-1',
        enabled: true,
        fallbackMessage: 'Ja te respondo',
      } as any);

      expect(flowsService.createOrUpdateDirectMessageBotFlow).toHaveBeenCalledWith(
        'org-1',
        'int-1',
        { enabled: true, fallbackMessage: 'Ja te respondo' },
        'profile-1'
      );
      expect(result).toEqual({ id: 'flow-dm' });
    });

    it('lista escalacoes e resolve uma conversa', async () => {
      dmFlowService.listEscalations.mockResolvedValue([{ id: 'c1' }]);
      dmFlowService.resolveConversation.mockResolvedValue({ id: 'c1', status: 'RESOLVED' });

      expect(await controller.listDmEscalations(org, 'profile-1')).toEqual([{ id: 'c1' }]);
      expect(dmFlowService.listEscalations).toHaveBeenCalledWith('org-1', 'profile-1');

      expect(await controller.resolveDmEscalation(org, 'profile-1', 'c1')).toEqual({ id: 'c1', status: 'RESOLVED' });
      expect(dmFlowService.resolveConversation).toHaveBeenCalledWith('org-1', 'c1', 'profile-1');
    });
  });
});
