import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import axios from 'axios';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { GaxiosResponse } from 'gaxios/build/src/common';
import Schema$Video = youtube_v3.Schema$Video;
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import {
  buildMetric,
  sumSeries,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.helper';
import { AnalyticsUnit } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

/** Metricas do canal (YouTube Analytics API v2), na ordem exibida. */
const YOUTUBE_METRICS: { key: string; label: string; unit: AnalyticsUnit }[] = [
  { key: 'views', label: 'Views', unit: 'count' },
  { key: 'estimatedMinutesWatched', label: 'Estimated Minutes Watched', unit: 'count' },
  { key: 'averageViewDuration', label: 'Average View Duration', unit: 'seconds' },
  { key: 'averageViewPercentage', label: 'Average View Percentage', unit: 'percent' },
  { key: 'subscribersGained', label: 'Subscribers Gained', unit: 'count' },
  { key: 'subscribersLost', label: 'Subscribers Lost', unit: 'count' },
  { key: 'likes', label: 'Likes', unit: 'count' },
  { key: 'comments', label: 'Comments', unit: 'count' },
  { key: 'shares', label: 'Shares', unit: 'count' },
];

const clientAndYoutube = (clientInformation?: ClientInformation) => {
  const client = new google.auth.OAuth2({
    clientId: clientInformation?.client_id || process.env.YOUTUBE_CLIENT_ID,
    clientSecret:
      clientInformation?.client_secret || process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
  });

  const youtube = (newClient: OAuth2Client) =>
    google.youtube({
      version: 'v3',
      auth: newClient,
    });

  const youtubeAnalytics = (newClient: OAuth2Client) =>
    google.youtubeAnalytics({
      version: 'v2',
      auth: newClient,
    });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  return { client, youtube, oauth2, youtubeAnalytics };
};

@Rules('YouTube must have on video attachment, it cannot be empty')
export class YoutubeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 200; // YouTube has strict upload quotas
  identifier = 'youtube';
  name = 'YouTube';
  isBetweenSteps = true;
  keepReconnectAuthTokens = true;
  dto = YoutubeSettingsDto;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 5000;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('invalidTitle')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the title. Title is too long.',
      };
    }

    if (body.includes('failedPrecondition')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.',
      };
    }

    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You have reached your daily upload limit, please try again tomorrow.',
      };
    }

    if (body.includes('youtubeSignupRequired')) {
      return {
        type: 'bad-body',
        value:
          'You have to link your youtube account to your google account first.',
      };
    }

    if (body.includes('youtube.thumbnail')) {
      return {
        type: 'bad-body',
        value:
          'Your account is not verified, we have uploaded your video but we could not set the thumbnail. Please verify your account and try again.',
      };
    }

    if (body.includes('Unauthorized')) {
      return {
        type: 'refresh-token',
        value:
          'Token expired or invalid, please reconnect your YouTube account.',
      };
    }

    if (body.includes('UNAUTHENTICATED') || body.includes('invalid_grant')) {
      return {
        type: 'refresh-token',
        value: 'Please re-authenticate your YouTube account',
      };
    }

    return undefined;
  }

  async refreshToken(
    refresh_token: string,
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails> {
    // Passar clientInformation aqui e critico: o refresh_token foi emitido
    // pelo OAuth client do workspace (Settings > Credenciais > YouTube),
    // entao o refresh tem que usar o MESMO client_id/client_secret. Caso
    // contrario o Google retorna invalid_grant e o orchestrator marca a
    // integracao como `refreshNeeded` num loop infinito (usuario reconecta,
    // proximo cron quebra de novo). Sintoma anterior: refreshToken="" no
    // banco e mensagem "you need to reconnect" repetindo a cada hora.
    const { client, oauth2 } = clientAndYoutube(clientInformation);
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    const user = oauth2(client);
    const expiryDate = new Date(credentials.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token!,
      expiresIn: unixTimestamp!,
      refreshToken: credentials.refresh_token ?? refresh_token,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeId(7);
    const { client } = clientAndYoutube(clientInformation);
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        // Sem isso o Google pode pular a tela de consent quando a conta ja
        // autorizou o app, e nao emitir refresh_token novo.
        include_granted_scopes: false,
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeId(11),
      state,
    };
  }

  async revokeToken(accessToken: string): Promise<void> {
    // POST https://oauth2.googleapis.com/revoke?token={token}
    // Aceita access_token ou refresh_token. Se o token ja estiver expirado,
    // a chamada pode falhar — ignoramos silenciosamente porque o
    // include_granted_scopes=false + prompt=consent ja forcam novo refresh.
    try {
      await axios.post(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`,
        null,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } catch {
      // ignore
    }
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    const { client, oauth2 } = clientAndYoutube(clientInformation);
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token!);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    return {
      accessToken: tokens.access_token!,
      expiresIn: unixTimestamp,
      refreshToken: tokens.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      // Get all channels the user has access to
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        mine: true,
      });

      const channels = response.data.items || [];

      return channels.map((channel) => ({
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        picture: {
          data: {
            url: channel.snippet?.thumbnails?.default?.url || '',
          },
        },
        username: channel.snippet?.customUrl || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
      }));
    } catch (error) {
      console.error('Failed to fetch YouTube channels:', error);
      return [];
    }
  }

  async fetchPageInformation(accessToken: string, data: { id: string }) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [data.id],
      });

      const channel = response.data.items?.[0];

      if (!channel) {
        throw new Error('Channel not found');
      }

      return {
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        access_token: accessToken,
        picture: channel.snippet?.thumbnails?.default?.url || '',
        username: channel.snippet?.customUrl || '',
      };
    } catch (error) {
      console.error('Failed to fetch YouTube channel information:', error);
      throw error;
    }
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const pages = await this.pages(accessToken);
    const findPage = pages.find((p) => p.id === requiredId);

    if (!findPage) {
      throw new Error('Channel not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;

    const response = await axios({
      url: firstPost?.media?.[0]?.path,
      method: 'GET',
      responseType: 'stream',
    });

    const all: GaxiosResponse<Schema$Video> = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.insert({
          part: ['id', 'snippet', 'status'],
          notifySubscribers: true,
          requestBody: {
            snippet: {
              title: settings.title,
              description: firstPost?.message,
              ...(settings?.tags?.length
                ? { tags: settings.tags.map((p) => p.label) }
                : {}),
            },
            status: {
              privacyStatus: settings.type,
              selfDeclaredMadeForKids:
                settings.selfDeclaredMadeForKids === 'yes',
            },
          },
          media: {
            body: response.data,
          },
        }),
      true
    );

    if (settings?.thumbnail?.path) {
      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId: all?.data?.id!,
          media: {
            body: (
              await axios({
                url: settings?.thumbnail?.path,
                method: 'GET',
                responseType: 'stream',
              })
            ).data,
          },
        })
      );
    }

    return [
      {
        id: firstPost.id,
        releaseURL: `https://www.youtube.com/watch?v=${all?.data?.id}`,
        postId: all?.data?.id!,
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Serie diaria + totais do periodo calculados pelo proprio YouTube (medias
    // ponderadas corretas) + totais do periodo anterior para a variacao.
    // O YouTube costuma atrasar 2 a 3 dias. Ver docs/architecture/analytics-metricas.md.
    try {
      const days = Number.isFinite(date) && date > 0 ? Math.floor(date) : 7;
      const today = dayjs();
      const fmt = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');
      const current = {
        startDate: fmt(today.subtract(days - 1, 'day')),
        endDate: fmt(today),
      };
      const previous = {
        startDate: fmt(today.subtract(days * 2 - 1, 'day')),
        endDate: fmt(today.subtract(days, 'day')),
      };

      const { client, youtubeAnalytics } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtubeAnalytics(client);
      const metrics = YOUTUBE_METRICS.map((m) => m.key).join(',');

      const toRows = (data: any): any[] => {
        const columns: string[] =
          data?.columnHeaders?.map((p: any) => p.name) || [];
        return (data?.rows || []).map((row: any[]) =>
          columns.reduce((acc, name, index) => {
            acc[name] = row[index];
            return acc;
          }, {} as Record<string, any>)
        );
      };

      const [daily, totals, before] = await Promise.all([
        youtubeClient.reports.query({
          ids: 'channel==MINE',
          ...current,
          metrics,
          dimensions: 'day',
          sort: 'day',
        }),
        youtubeClient.reports
          .query({ ids: 'channel==MINE', ...current, metrics })
          .catch((): null => null),
        youtubeClient.reports
          .query({ ids: 'channel==MINE', ...previous, metrics })
          .catch((): null => null),
      ]);

      const dailyRows = toRows(daily?.data);
      const totalRow = toRows(totals?.data)[0];
      const previousRow = toRows(before?.data)[0];

      return YOUTUBE_METRICS.map((metric) => {
        const series = dailyRows.map((row) => ({
          total: String(Number(row[metric.key]) || 0),
          date: row.day,
        }));
        const fallback = series.length
          ? sumSeries(series) / (metric.unit === 'count' ? 1 : series.length)
          : 0;
        const round = (n: number) => Math.round(n * 100) / 100;
        const value = round(Number(totalRow?.[metric.key]));
        const prev = round(Number(previousRow?.[metric.key]));
        return buildMetric({
          label: metric.label,
          current: totalRow && Number.isFinite(value)
            ? value
            : Math.round(fallback * 100) / 100,
          previous:
            totalRow && previousRow && Number.isFinite(prev) ? prev : undefined,
          unit: metric.unit,
          series,
        });
      });
    } catch (err) {
      console.error('Error fetching YouTube analytics:', (err as Error)?.message || 'unknown error');
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      const { client, youtube } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });
      const youtubeClient = youtube(client);

      // Fetch video statistics
      const response = await youtubeClient.videos.list({
        part: ['statistics', 'snippet'],
        id: [postId],
      });

      const video = response.data.items?.[0];

      if (!video || !video.statistics) {
        return [];
      }

      const stats = video.statistics;
      const result: AnalyticsData[] = [];

      if (stats.viewCount !== undefined) {
        result.push({
          label: 'Views',
          percentageChange: 0,
          data: [{ total: String(stats.viewCount), date: today }],
        });
      }

      if (stats.likeCount !== undefined) {
        result.push({
          label: 'Likes',
          percentageChange: 0,
          data: [{ total: String(stats.likeCount), date: today }],
        });
      }

      if (stats.commentCount !== undefined) {
        result.push({
          label: 'Comments',
          percentageChange: 0,
          data: [{ total: String(stats.commentCount), date: today }],
        });
      }

      if (stats.favoriteCount !== undefined) {
        result.push({
          label: 'Favorites',
          percentageChange: 0,
          data: [{ total: String(stats.favoriteCount), date: today }],
        });
      }

      return result;
    } catch (err) {
      console.error('Error fetching YouTube post analytics:', (err as Error)?.message || 'unknown error');
      return [];
    }
  }
}
