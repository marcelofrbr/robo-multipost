import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isJsonArrayString', async: false })
class IsJsonArrayString implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      return Array.isArray(JSON.parse(value));
    } catch {
      return false;
    }
  }
  defaultMessage(): string {
    return 'additionalSettings deve ser um array JSON (ou a string JSON de um array)';
  }
}

export class UpdateIntegrationSettingsDto {
  @ApiProperty({
    description:
      'Configurações do provedor no formato da tela: array de `{ title, value }`. Pode vir como array ou como string JSON.',
    example: [{ title: 'Verified', value: true }],
  })
  // O service grava string (mesmo contrato da UI); aceitar array e mais
  // natural para clientes de API.
  @Transform(({ value }) =>
    typeof value === 'string' ? value : JSON.stringify(value)
  )
  @IsString()
  @MaxLength(20000)
  @Validate(IsJsonArrayString)
  additionalSettings: string;
}
