import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePostCommentDto {
  @ApiProperty({
    maxLength: 2000,
    description: 'Comentário interno (não vai para a rede social).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment: string;
}
