jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: class RefreshIntegrationServiceMock {},
}));

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
