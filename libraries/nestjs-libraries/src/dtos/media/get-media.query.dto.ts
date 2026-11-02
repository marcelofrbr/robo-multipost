import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export class GetMediaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Instante ISO 8601 (UTC). O frontend calcula o inicio do dia no fuso do
  // usuario e envia o instante correspondente.
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  // Inclusivo: o frontend envia o fim do dia local (23:59:59.999).
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
