import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
import { IntegrationRepository } from './integration.repository';

const build = (integration: ReturnType<typeof createPrismaRepositoryMock>) =>
  new IntegrationRepository(
    integration as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

describe('IntegrationRepository enable/disable', () => {
  it('disableChannel grava disabled=true no escopo da org e devolve { id, disabled }', async () => {
    const integration = createPrismaRepositoryMock('integration');
    integration.model.integration.update.mockResolvedValue({ id: 'int-1', disabled: true } as any);

    const r = await build(integration).disableChannel('org-1', 'int-1');

    expect(integration.model.integration.update).toHaveBeenCalledWith({
      where: { id: 'int-1', organizationId: 'org-1' },
      data: { disabled: true },
      select: { id: true, disabled: true },
    });
    expect(r).toEqual({ id: 'int-1', disabled: true });
  });

  it('enableChannel grava disabled=false e devolve { id, disabled } (sem token/refreshToken)', async () => {
    const integration = createPrismaRepositoryMock('integration');
    integration.model.integration.update.mockResolvedValue({ id: 'int-1', disabled: false } as any);

    const r = await build(integration).enableChannel('org-1', 'int-1');

    expect(integration.model.integration.update).toHaveBeenCalledWith({
      where: { id: 'int-1', organizationId: 'org-1' },
      data: { disabled: false },
      select: { id: true, disabled: true },
    });
    expect(r).toEqual({ id: 'int-1', disabled: false });
  });
});
