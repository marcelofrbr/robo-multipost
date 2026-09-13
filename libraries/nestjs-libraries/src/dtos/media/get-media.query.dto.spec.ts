import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetMediaQueryDto } from './get-media.query.dto';

const build = (query: Record<string, unknown>) =>
  plainToInstance(GetMediaQueryDto, query);

describe('GetMediaQueryDto', () => {
  it('aceita query vazia (todos os campos opcionais)', async () => {
    const errors = await validate(build({}));
    expect(errors).toHaveLength(0);
  });

  it('converte page para numero', async () => {
    const dto = build({ page: '3' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
  });

  it('rejeita page menor que 1', async () => {
    const errors = await validate(build({ page: '0' }));
    expect(errors.map((e) => e.property)).toEqual(['page']);
  });

  it('aceita from e to em ISO 8601', async () => {
    const errors = await validate(
      build({
        from: '2026-09-01T03:00:00.000Z',
        to: '2026-09-30T02:59:59.999Z',
      })
    );
    expect(errors).toHaveLength(0);
  });

  it('rejeita from que nao e ISO 8601', async () => {
    const errors = await validate(build({ from: '01/09/2026' }));
    expect(errors.map((e) => e.property)).toEqual(['from']);
  });

  it('rejeita to que nao e ISO 8601', async () => {
    const errors = await validate(build({ to: 'ontem' }));
    expect(errors.map((e) => e.property)).toEqual(['to']);
  });
});
