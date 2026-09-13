import { OrganizationService } from './organization.service';
import { OrganizationRepository } from './organization.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('OrganizationService.getOwnerUserId', () => {
  const build = (repo: ReturnType<typeof createMock<OrganizationRepository>>) =>
    new OrganizationService(repo, null as any);

  it('devolve o id do SUPERADMIN da org', async () => {
    const repo = createMock<OrganizationRepository>();
    repo.getTeam.mockResolvedValue({
      users: [
        { role: 'USER', user: { id: 'u-2' } },
        { role: 'SUPERADMIN', user: { id: 'u-1' } },
      ],
    } as any);

    await expect(build(repo).getOwnerUserId('org-1')).resolves.toBe('u-1');
  });

  it('cai para o primeiro membro quando nao ha SUPERADMIN e lanca 412 sem membros', async () => {
    const repo = createMock<OrganizationRepository>();
    repo.getTeam.mockResolvedValue({ users: [{ role: 'ADMIN', user: { id: 'u-9' } }] } as any);
    await expect(build(repo).getOwnerUserId('org-1')).resolves.toBe('u-9');

    repo.getTeam.mockResolvedValue({ users: [] } as any);
    await expect(build(repo).getOwnerUserId('org-1')).rejects.toMatchObject({ status: 412 });
  });
});
