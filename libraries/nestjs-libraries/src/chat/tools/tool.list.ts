import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@gitroom/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { KnowledgeQueryTool } from '@gitroom/nestjs-libraries/chat/tools/knowledge.query.tool';
import { WebSearchTool } from '@gitroom/nestjs-libraries/chat/tools/web-search.tool';
import { ExtractUrlsTool } from '@gitroom/nestjs-libraries/chat/tools/extract-urls.tool';
import { UploadMediaFromUrlTool } from '@gitroom/nestjs-libraries/chat/tools/upload.media.from.url.tool';
import { MediaListTool } from '@gitroom/nestjs-libraries/chat/tools/media.list.tool';
import { MediaCleanupTool } from '@gitroom/nestjs-libraries/chat/tools/media.cleanup.tool';
import {
  ListAutomationsTool,
  ListInstagramPostsForAutomationTool,
  CreateCommentAutomationTool,
  SetAutomationStatusTool,
  GetAutomationTool,
  UpdateAutomationTool,
  DeleteAutomationTool,
  AutomationExecutionsTool,
  WebhookStatusTool,
} from '@gitroom/nestjs-libraries/chat/tools/automations.tool';
import { DmBotConfigTool } from '@gitroom/nestjs-libraries/chat/tools/dm-bot.config.tool';
import {
  DmEscalationsListTool,
  ResolveDmEscalationTool,
} from '@gitroom/nestjs-libraries/chat/tools/dm-escalations.list.tool';
import {
  ListPostsTool,
  GetPostTool,
  DeletePostTool,
  ChangePostDateTool,
  FindFreeSlotTool,
  PostStatisticsTool,
  CreatePostCommentTool,
} from '@gitroom/nestjs-libraries/chat/tools/posts.tool';
import {
  IntegrationAnalyticsTool,
  PostAnalyticsTool,
} from '@gitroom/nestjs-libraries/chat/tools/analytics.tool';
import {
  ListProfilesTool,
  ListNotificationsTool,
} from '@gitroom/nestjs-libraries/chat/tools/profiles.notifications.tool';
import {
  DeleteMediaTool,
  SaveMediaInformationTool,
} from '@gitroom/nestjs-libraries/chat/tools/media.manage.tool';
import {
  IntegrationEnableTool,
  IntegrationDisableTool,
  IntegrationSettingsTool,
  IntegrationAuthUrlTool,
} from '@gitroom/nestjs-libraries/chat/tools/integration.manage.tool';

export const toolList = [
  IntegrationListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  GenerateImageTool,
  KnowledgeQueryTool,
  WebSearchTool,
  ExtractUrlsTool,
  UploadMediaFromUrlTool,
  MediaListTool,
  MediaCleanupTool,
  ListAutomationsTool,
  ListInstagramPostsForAutomationTool,
  CreateCommentAutomationTool,
  SetAutomationStatusTool,
  DmBotConfigTool,
  DmEscalationsListTool,
  // Paridade com a API publica (entrega 3) — cada tool espelha uma rota
  // de /public/v1 e usa os mesmos helpers de escopo dos services.
  // Posts
  ListPostsTool,
  GetPostTool,
  DeletePostTool,
  ChangePostDateTool,
  FindFreeSlotTool,
  PostStatisticsTool,
  CreatePostCommentTool,
  // Metricas, perfis, notificacoes
  IntegrationAnalyticsTool,
  PostAnalyticsTool,
  ListProfilesTool,
  ListNotificationsTool,
  // Midia
  DeleteMediaTool,
  SaveMediaInformationTool,
  // Canais
  IntegrationEnableTool,
  IntegrationDisableTool,
  IntegrationSettingsTool,
  IntegrationAuthUrlTool,
  // Automacoes e DM
  GetAutomationTool,
  UpdateAutomationTool,
  DeleteAutomationTool,
  AutomationExecutionsTool,
  WebhookStatusTool,
  ResolveDmEscalationTool,
];
