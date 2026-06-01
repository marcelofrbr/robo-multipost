import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { DmConversationStatus } from '@prisma/client';

@Injectable()
export class DmRepository {
  constructor(
    private _dmConversation: PrismaRepository<'dmConversation'>,
    private _dmMessage: PrismaRepository<'dmMessage'>
  ) {}

  upsertConversation(data: {
    organizationId: string;
    profileId?: string;
    integrationId: string;
    igAccountId: string;
    igSenderId: string;
    igSenderName?: string;
    source?: string;
  }) {
    return this._dmConversation.model.dmConversation.upsert({
      where: {
        integrationId_igSenderId: {
          integrationId: data.integrationId,
          igSenderId: data.igSenderId,
        },
      },
      create: {
        organizationId: data.organizationId,
        ...(data.profileId ? { profileId: data.profileId } : {}),
        integrationId: data.integrationId,
        igAccountId: data.igAccountId,
        igSenderId: data.igSenderId,
        ...(data.igSenderName !== undefined
          ? { igSenderName: data.igSenderName }
          : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
      },
      update: {
        igSenderName: data.igSenderName,
      },
    });
  }

  setLastInbound(id: string) {
    return this._dmConversation.model.dmConversation.update({
      where: { id },
      data: { lastInboundAt: new Date() },
    });
  }

  appendMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    text: string,
    metaMid?: string
  ) {
    return this._dmMessage.model.dmMessage.create({
      data: {
        conversationId,
        role,
        text,
        metaMid,
      },
    });
  }

  findByMetaMid(metaMid: string) {
    return this._dmMessage.model.dmMessage.findUnique({
      where: { metaMid },
    });
  }

  getRecentMessages(conversationId: string, limit: number) {
    return this._dmMessage.model.dmMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  markHandoff(id: string, reason: string) {
    return this._dmConversation.model.dmConversation.update({
      where: { id },
      data: {
        status: DmConversationStatus.HUMAN_HANDOFF,
        escalatedAt: new Date(),
        escalationReason: reason,
      },
    });
  }

  incrementBotReply(id: string) {
    return this._dmConversation.model.dmConversation.update({
      where: { id },
      data: {
        botReplyCount: { increment: 1 },
        lastBotReplyAt: new Date(),
      },
    });
  }

  listEscalations(orgId: string, profileId?: string) {
    return this._dmConversation.model.dmConversation.findMany({
      where: {
        organizationId: orgId,
        status: DmConversationStatus.HUMAN_HANDOFF,
        ...(profileId ? { profileId } : {}),
      },
      orderBy: { escalatedAt: 'desc' },
    });
  }

  closeConversation(id: string) {
    return this._dmConversation.model.dmConversation.update({
      where: { id },
      data: { status: DmConversationStatus.CLOSED },
    });
  }

  reactivate(id: string) {
    return this._dmConversation.model.dmConversation.update({
      where: { id },
      data: { status: DmConversationStatus.BOT_ACTIVE },
    });
  }
}
