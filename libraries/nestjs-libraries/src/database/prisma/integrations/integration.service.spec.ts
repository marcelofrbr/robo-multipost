jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: class RefreshIntegrationServiceMock {},
}));

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(), get: jest.fn() },
}));

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationService } from './integration.service';
import { IntegrationRepository } from './integration.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';

const build = (repo: ReturnType<typeof createMock<IntegrationRepository>>) =>
  new IntegrationService(repo, null as any, null as any, null as any, null as any, null as any);

describe('IntegrationService.getIntegrationInScope', () => {
  it('devolve o canal quando esta na org e no perfil (ou sem perfil = compartilhado)', async () => {
    const repo = createMock<IntegrationRepository>();
    repo.getIntegrationById.mockResolvedValue({ id: 'int-1', profileId: null, deletedAt: null } as any);

    await expect(
      build(repo).getIntegrationInScope('org-1', 'int-1', 'prof-1')
    ).resolves.toMatchObject({ id: 'int-1' });
    expect(repo.getIntegrationById).toHaveBeenCalledWith('org-1', 'int-1');
  });

  it('lanca 404 quando nao existe ou esta apagado', async () => {
    const repo = createMock<IntegrationRepository>();
    repo.getIntegrationById.mockResolvedValue(null as any);
    await expect(build(repo).getIntegrationInScope('org-1', 'x')).rejects.toMatchObject({ status: 404 });

    repo.getIntegrationById.mockResolvedValue({ id: 'int-1', deletedAt: new Date() } as any);
    await expect(build(repo).getIntegrationInScope('org-1', 'int-1')).rejects.toMatchObject({ status: 404 });
  });

  it('lanca 403 quando o canal e de outro perfil', async () => {
    const repo = createMock<IntegrationRepository>();
    repo.getIntegrationById.mockResolvedValue({ id: 'int-1', profileId: 'prof-outro', deletedAt: null } as any);

    await expect(
      build(repo).getIntegrationInScope('org-1', 'int-1', 'prof-1')
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('IntegrationService.createAuthUrl (OAuth pela API/MCP)', () => {
  const makeManager = (allowed = ['instagram'], externalUrl = false) => ({
    getAllowedSocialsIntegrations: () => allowed,
    getSocialIntegration: () => ({
      externalUrl,
      generateAuthUrl: async () => ({ url: 'https://meta/oauth', state: 'st', codeVerifier: 'cv' }),
    }),
  });
  const buildWithManager = (manager: any) =>
    new IntegrationService(createMock<IntegrationRepository>(), null as any, manager, null as any, null as any, null as any);

  beforeEach(() => {
    (ioRedis.set as jest.Mock).mockClear();
  });

  it('gera a URL e grava organization/login/profile no state (TTL 1h)', async () => {
    const r = await buildWithManager(makeManager()).createAuthUrl('org-1', 'instagram', { profileId: 'prof-1' });

    expect(r).toEqual({ url: 'https://meta/oauth' });
    expect(ioRedis.set).toHaveBeenCalledWith('organization:st', 'org-1', 'EX', 3600);
    expect(ioRedis.set).toHaveBeenCalledWith('login:st', 'cv', 'EX', 3600);
    expect(ioRedis.set).toHaveBeenCalledWith('profile:st', 'prof-1', 'EX', 3600);
  });

  it('chave de org sem perfil: nao grava profile:; refresh grava refresh:', async () => {
    await buildWithManager(makeManager()).createAuthUrl('org-1', 'instagram', { refresh: 'int-9' });

    const keys = (ioRedis.set as jest.Mock).mock.calls.map((c) => c[0]);
    expect(keys).toEqual(expect.arrayContaining(['organization:st', 'login:st', 'refresh:st']));
    expect(keys).not.toContain('profile:st');
  });

  it('400 para provedor nao permitido ou que exige URL externa', async () => {
    await expect(buildWithManager(makeManager(['youtube'])).createAuthUrl('org-1', 'instagram', {})).rejects.toMatchObject({ status: 400 });
    await expect(buildWithManager(makeManager(['instagram'], true)).createAuthUrl('org-1', 'instagram', {})).rejects.toMatchObject({ status: 400 });
  });
});
