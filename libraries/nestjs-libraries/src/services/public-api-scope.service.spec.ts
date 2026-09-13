import { PublicApiScopeService } from './public-api-scope.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';

describe('PublicApiScopeService.resolveProfileId', () => {
  const build = (profiles: ReturnType<typeof createMock<ProfileService>>) =>
    new PublicApiScopeService(profiles);

  it('chave de perfil: usa o proprio perfil e ignora ?profileId igual', async () => {
    const profiles = createMock<ProfileService>();
    const svc = build(profiles);
    await expect(svc.resolveProfileId('org-1', 'prof-1', undefined)).resolves.toBe('prof-1');
    await expect(svc.resolveProfileId('org-1', 'prof-1', 'prof-1')).resolves.toBe('prof-1');
    expect(profiles.getProfileById).not.toHaveBeenCalled();
  });

  it('chave de perfil: ?profileId divergente -> 403', async () => {
    const svc = build(createMock<ProfileService>());
    await expect(svc.resolveProfileId('org-1', 'prof-1', 'prof-9')).rejects.toMatchObject({ status: 403 });
  });

  it('chave de org sem ?profileId -> sem filtro (undefined)', async () => {
    const profiles = createMock<ProfileService>();
    await expect(build(profiles).resolveProfileId('org-1', undefined, undefined)).resolves.toBeUndefined();
    expect(profiles.getProfileById).not.toHaveBeenCalled();
  });

  it('chave de org com ?profileId: exige que o perfil seja da org (404 se nao for)', async () => {
    const profiles = createMock<ProfileService>();
    profiles.getProfileById.mockResolvedValueOnce({ id: 'prof-2' } as any);
    await expect(build(profiles).resolveProfileId('org-1', undefined, 'prof-2')).resolves.toBe('prof-2');
    expect(profiles.getProfileById).toHaveBeenCalledWith('org-1', 'prof-2');

    profiles.getProfileById.mockResolvedValueOnce(null as any);
    await expect(build(profiles).resolveProfileId('org-1', undefined, 'prof-de-outra-org')).rejects.toMatchObject({ status: 404 });
  });
});
