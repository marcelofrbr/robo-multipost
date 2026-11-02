import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';

/**
 * Regra unica de escopo de perfil da API publica (todos os controllers de
 * /public/v1 usam este helper em vez de reimplementar):
 *
 * - chave de perfil: opera SO no proprio perfil; `?profileId` divergente -> 403;
 * - chave de organizacao sem `?profileId`: sem filtro (ve tudo);
 * - chave de organizacao com `?profileId`: o perfil precisa ser desta org
 *   (404 se nao for) — sem isso um id de perfil de OUTRA organizacao seria
 *   persistido em Flow/Integration (OAuth) apontando para fora da org.
 */
@Injectable()
export class PublicApiScopeService {
  constructor(private _profileService: ProfileService) {}

  async resolveProfileId(
    orgId: string,
    publicApiProfileId?: string,
    requestedProfileId?: string
  ): Promise<string | undefined> {
    if (
      publicApiProfileId &&
      requestedProfileId &&
      requestedProfileId !== publicApiProfileId
    ) {
      throw new HttpException(
        { msg: 'Profile key cannot access another profile' },
        403
      );
    }
    if (publicApiProfileId) {
      return publicApiProfileId;
    }
    if (!requestedProfileId) {
      return undefined;
    }
    const profile = await this._profileService.getProfileById(
      orgId,
      requestedProfileId
    );
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return requestedProfileId;
  }
}
