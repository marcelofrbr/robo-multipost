import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class ChangePostDateDto {
  @ApiProperty({
    example: '2026-09-20T13:00:00.000Z',
    description: 'Nova data/hora (ISO 8601, UTC).',
  })
  @IsISO8601({ strict: true })
  date: string;

  @ApiPropertyOptional({
    enum: ['schedule', 'update'],
    default: 'schedule',
    description:
      '`schedule` reagenda (volta para a fila); `update` só troca a data sem mexer no status.',
  })
  @IsOptional()
  @IsIn(['schedule', 'update'])
  action?: 'schedule' | 'update';
}
