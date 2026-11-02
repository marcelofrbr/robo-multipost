import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateIntegrationSettingsDto } from './update.integration.settings.dto';

describe('UpdateIntegrationSettingsDto', () => {
  it('aceita array e serializa para a string JSON que o service grava', async () => {
    const dto = plainToInstance(UpdateIntegrationSettingsDto, {
      additionalSettings: [{ title: 'Verified', value: true }],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.additionalSettings).toBe('[{"title":"Verified","value":true}]');
  });

  it('aceita string JSON de array e rejeita JSON invalido ou que nao e array', async () => {
    const ok = plainToInstance(UpdateIntegrationSettingsDto, { additionalSettings: '[]' });
    expect(await validate(ok)).toHaveLength(0);

    const invalido = plainToInstance(UpdateIntegrationSettingsDto, { additionalSettings: '{nao json' });
    expect(await validate(invalido)).not.toHaveLength(0);

    const objeto = plainToInstance(UpdateIntegrationSettingsDto, { additionalSettings: '{"a":1}' });
    expect(await validate(objeto)).not.toHaveLength(0);
  });
});
