jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class RefreshIntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class MediaServiceMock {} })
);

import { ZernioIntegrationsController } from './zernio.integrations.controller';

const mockListAccounts = jest.fn();

jest.mock('@zernio/node', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    accounts: { listAccounts: mockListAccounts },
  })),
}));

const makeOrganizationService = () => ({
  getShareZernioWithProfiles: jest.fn(),
  getDecryptedZernioApiKey: jest.fn(),
});

const makeProfileService = () => ({
  getDecryptedZernioApiKey: jest.fn().mockResolvedValue('zernio-key-mfpro'),
});

const makeIntegrationService = () => ({
  createOrUpdateIntegration: jest.fn().mockResolvedValue({ id: 'int-1' }),
});

const org = { id: 'org-1' } as any;
const profile = { id: 'prof-mfpro' } as any;

const zernioProfileId = '69fe1d30eab99a0db856d162';
const tiktokAccountId = '6aa45cce726ebfe037dbee80';

const zernioAccounts = [
  {
    _id: '69fe1d6692b3d8e85f9ec36d',
    platform: 'instagram',
    username: 'francadigital1',
    displayName: 'Growth',
  },
  {
    _id: tiktokAccountId,
    platform: 'tiktok',
    username: 'marcelofrancapro',
    displayName: 'Marcelo Franca Pro',
  },
];

describe('ZernioIntegrationsController', () => {
  let controller: ZernioIntegrationsController;
  let organizationService: ReturnType<typeof makeOrganizationService>;
  let profileService: ReturnType<typeof makeProfileService>;
  let integrationService: ReturnType<typeof makeIntegrationService>;

  beforeEach(() => {
    mockListAccounts.mockReset();
    organizationService = makeOrganizationService();
    profileService = makeProfileService();
    integrationService = makeIntegrationService();
    controller = new ZernioIntegrationsController(
      organizationService as any,
      profileService as any,
      integrationService as any
    );
  });

  describe('connectZernioAccount', () => {
    const body = {
      zernioProfileId,
      accountId: tiktokAccountId,
      platform: 'tiktok',
      username: 'forjado',
      displayName: 'Nome Forjado',
    };

    it('rejeita plataforma nao suportada antes de consultar o zernio', async () => {
      await expect(
        controller.connectZernioAccount(org, profile, {
          ...body,
          platform: 'myspace',
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(mockListAccounts).not.toHaveBeenCalled();
      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('rejeita quando zernioProfileId nao e informado', async () => {
      await expect(
        controller.connectZernioAccount(org, profile, {
          ...body,
          zernioProfileId: '',
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(mockListAccounts).not.toHaveBeenCalled();
      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('consulta as contas do perfil zernio com a chave do proprio usuario', async () => {
      mockListAccounts.mockResolvedValue({
        data: { accounts: zernioAccounts },
      });

      await controller.connectZernioAccount(org, profile, body);

      expect(profileService.getDecryptedZernioApiKey).toHaveBeenCalledWith(
        'prof-mfpro'
      );
      expect(mockListAccounts).toHaveBeenCalledWith({
        query: { profileId: zernioProfileId },
      });
    });

    it('rejeita accountId que nao pertence ao perfil zernio do usuario', async () => {
      mockListAccounts.mockResolvedValue({
        data: { accounts: zernioAccounts },
      });

      await expect(
        controller.connectZernioAccount(org, profile, {
          ...body,
          accountId: 'conta-de-outra-pessoa',
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('rejeita quando a plataforma enviada difere da conta no zernio', async () => {
      mockListAccounts.mockResolvedValue({
        data: { accounts: zernioAccounts },
      });

      await expect(
        controller.connectZernioAccount(org, profile, {
          ...body,
          platform: 'instagram',
        })
      ).rejects.toMatchObject({ status: 400 });

      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('propaga 500 quando o zernio falha ao listar contas', async () => {
      mockListAccounts.mockResolvedValue({ error: { message: 'boom' } });

      await expect(
        controller.connectZernioAccount(org, profile, body)
      ).rejects.toMatchObject({ status: 500 });

      expect(
        integrationService.createOrUpdateIntegration
      ).not.toHaveBeenCalled();
    });

    it('grava nome e username vindos do zernio, ignorando os do body', async () => {
      mockListAccounts.mockResolvedValue({
        data: { accounts: zernioAccounts },
      });

      const result = await controller.connectZernioAccount(org, profile, body);

      expect(result).toEqual({ id: 'int-1', inBetweenSteps: false });
      expect(
        integrationService.createOrUpdateIntegration
      ).toHaveBeenCalledTimes(1);

      const args = integrationService.createOrUpdateIntegration.mock.calls[0];
      expect(args[2]).toBe('org-1');
      expect(args[3]).toBe('Marcelo Franca Pro');
      expect(args[4]).toBe('/icons/platforms/tiktok.png');
      expect(args[6]).toBe(`${tiktokAccountId}_pprof-mfpro`);
      expect(args[7]).toBe('zernio-tiktok');
      expect(args[8]).toBe('zernio-key-mfpro');
      expect(args[11]).toBe('marcelofrancapro');
      expect(JSON.parse(args[15])).toEqual({
        zernioProfileId,
        zernioAccountId: tiktokAccountId,
      });
      expect(args[16]).toBe('prof-mfpro');
    });

    it('cai no username do zernio quando a conta nao tem displayName', async () => {
      mockListAccounts.mockResolvedValue({
        data: {
          accounts: [
            {
              _id: tiktokAccountId,
              platform: 'tiktok',
              username: 'soUsername',
            },
          ],
        },
      });

      await controller.connectZernioAccount(org, profile, body);

      const args = integrationService.createOrUpdateIntegration.mock.calls[0];
      expect(args[3]).toBe('soUsername');
      expect(args[11]).toBe('soUsername');
    });

    it('usa o accountId puro como internalId quando nao ha perfil ativo', async () => {
      organizationService.getDecryptedZernioApiKey.mockResolvedValue('org-key');
      mockListAccounts.mockResolvedValue({
        data: { accounts: zernioAccounts },
      });

      await controller.connectZernioAccount(org, undefined as any, body);

      const args = integrationService.createOrUpdateIntegration.mock.calls[0];
      expect(args[6]).toBe(tiktokAccountId);
      expect(args[8]).toBe('org-key');
      expect(args[16]).toBeUndefined();
    });
  });
});
