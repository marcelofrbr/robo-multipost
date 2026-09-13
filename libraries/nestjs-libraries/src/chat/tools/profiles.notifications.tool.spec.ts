jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ListProfilesTool, ListNotificationsTool } from './profiles.notifications.tool';

const run = (tool: any, input: any, profileId?: string) =>
  runWithContext({ requestId: 'r', auth: { id: 'org-1' }, profileId }, () =>
    tool.run().execute(input, {} as any)
  );

describe('profiles/notifications tools', () => {
  it('listProfiles: chave de perfil ve so o proprio perfil; chave de org ve todos', async () => {
    const profiles = createMock<ProfileService>();
    profiles.getProfileById.mockResolvedValue({ id: 'prof-1', name: 'MFPRO', isDefault: false, apiKey: 'k' } as any);
    profiles.getProfilesByOrgId.mockResolvedValue([
      { id: 'a', name: 'Default', isDefault: true },
      { id: 'b', name: 'X', isDefault: false },
    ] as any);

    expect((await run(new ListProfilesTool(profiles), {}, 'prof-1')).profiles).toEqual([
      { id: 'prof-1', name: 'MFPRO', isDefault: false },
    ]);
    expect((await run(new ListProfilesTool(profiles), {})).profiles).toHaveLength(2);
  });

  it('listNotifications pagina a partir de 0 e resume as notificacoes', async () => {
    const notifications = createMock<NotificationService>();
    notifications.getNotificationsPaginated.mockResolvedValue({
      notifications: [{ id: 'n1', content: 'x', createdAt: new Date('2026-09-13T00:00:00Z') }],
      total: 1,
      hasMore: false,
    } as any);

    const r = await run(new ListNotificationsTool(notifications), { page: '0' });

    expect(notifications.getNotificationsPaginated).toHaveBeenCalledWith('org-1', 0);
    expect(r).toEqual({
      total: 1,
      hasMore: false,
      notifications: [{ id: 'n1', content: 'x', createdAt: '2026-09-13T00:00:00.000Z' }],
    });
  });
});
