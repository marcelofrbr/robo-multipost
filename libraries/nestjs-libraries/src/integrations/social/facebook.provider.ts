import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { Integration } from '@prisma/client';
import {
  AnalyticsWindow,
  analyticsWindows,
  buildMetric,
  fetchMetaInsights,
  metaSeries,
  sumSeries,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.helper';

/** Metricas diarias de Pagina vigentes (substitutas das page_impressions*). */
const FACEBOOK_PAGE_METRICS = [
  'page_media_view',
  'page_total_media_view_unique',
  'page_post_engagements',
  'page_daily_follows_unique',
  'page_video_views',
];

const FACEBOOK_PAGE_LABELS: Record<string, string> = {
  page_media_view: 'Views',
  page_total_media_view_unique: 'Daily Reach (avg)',
  page_post_engagements: 'Posts Engagement',
  page_daily_follows_unique: 'New Followers',
  page_video_views: 'Videos views',
};

const FACEBOOK_POST_METRICS = [
  'post_media_view',
  'post_total_media_view_unique',
  'post_reactions_by_type_total',
  'post_clicks',
];

const FACEBOOK_POST_LABELS: Record<string, string> = {
  post_media_view: 'Views',
  post_total_media_view_unique: 'Reach',
  post_reactions_by_type_total: 'Reactions',
  post_clicks: 'Clicks',
};

// Aborta a chamada Graph API se passar de `timeoutMs` ms. Evita que uma
// chamada lenta a graph.facebook.com (comum em agencias com muitas pages
// via Business Manager) trave o OAuth callback inteiro e cause 504 do Nginx.
async function fetchWithTimeout(
  url: string,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class FacebookProvider extends SocialAbstract implements SocialProvider {
  identifier = 'facebook';
  name = 'Facebook Page';
  isBetweenSteps = true;
  scopes = [
    'pages_show_list',
    'business_management',
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement',
    'read_insights',
  ];
  override maxConcurrentJob = 100; // Facebook has reasonable rate limits
  editor = 'normal' as const;
  maxLength() {
    return 63206;
  }
  dto = FacebookDto;

  override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Access token validation errors - require re-authentication
    if (body.indexOf('Error validating access token') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Please re-authenticate your Facebook account',
      };
    }

    if (body.indexOf('490') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token expired, please re-authenticate',
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token has been revoked, please re-authenticate',
      };
    }

    if (body.indexOf('1366046') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Photos should be smaller than 4 MB and saved as JPG, PNG',
      };
    }

    if (body.indexOf('1390008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You are posting too fast, please slow down',
      };
    }

    // Content policy violations
    if (body.indexOf('1346003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content flagged as abusive by Facebook',
      };
    }

    if (body.indexOf('1404006') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          "We couldn't post your comment, A security check in facebook required to proceed.",
      };
    }

    if (body.indexOf('1404102') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content violates Facebook Community Standards',
      };
    }

    // Permission errors
    if (body.indexOf('1404078') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Page publishing authorization required, please re-authenticate',
      };
    }

    if (body.indexOf('1609008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Cannot post Facebook.com links',
      };
    }

    // Parameter validation errors
    if (body.indexOf('2061006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid URL format in post content',
      };
    }

    if (body.indexOf('1349125') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid content format',
      };
    }

    if (body.indexOf('1404112') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'For security reasons, your account has limited access to the site for a few days',
      };
    }

    if (body.indexOf('Name parameter too long') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Post content is too long',
      };
    }

    // Service errors - checking specific subcodes first
    if (body.indexOf('1363047') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('1609010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (status === 401) {
      return {
        type: 'bad-body' as const,
        value:
          'An unknown error occurred, please try again later or contact support',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const clientId = clientInformation?.client_id || process.env.FACEBOOK_APP_ID;
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/facebook`
        )}` +
        `&state=${state}` +
        `&scope=${this.scopes.join(',')}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }, clientInformation?: ClientInformation) {
    const clientId = clientInformation?.client_id || process.env.FACEBOOK_APP_ID;
    const clientSecret = clientInformation?.client_secret || process.env.FACEBOOK_APP_SECRET;

    console.log('[Facebook.authenticate] credentials source:', {
      hasClientInfo: !!clientInformation,
      clientIdPrefix: String(clientId || '').slice(0, 6) + '...',
      hasSecret: !!clientSecret,
      redirectUri: `${process.env.FRONTEND_URL}/integrations/social/facebook${
        params.refresh ? `?refresh=${params.refresh}` : ''
      }`,
    });

    const getAccessToken = await (
      await fetchWithTimeout(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/facebook${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${clientSecret}` +
          `&code=${params.code}`
      )
    ).json();

    if (!getAccessToken.access_token) {
      console.error('[Facebook.authenticate] token exchange retornou erro:', getAccessToken);
      throw new Error(
        `Meta token exchange failed: ${JSON.stringify(getAccessToken.error || getAccessToken)}`
      );
    }

    const longLivedResponse = await (
      await fetchWithTimeout(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${clientId}` +
          `&client_secret=${clientSecret}` +
          `&fb_exchange_token=${getAccessToken.access_token}&fields=access_token,expires_in`
      )
    ).json();

    if (!longLivedResponse.access_token) {
      console.error('[Facebook.authenticate] long-lived token exchange retornou erro:', longLivedResponse);
      throw new Error(
        `Meta long-lived token exchange failed: ${JSON.stringify(longLivedResponse.error || longLivedResponse)}`
      );
    }
    const { access_token } = longLivedResponse;

    const permsResponse = await (
      await fetchWithTimeout(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    if (!permsResponse.data) {
      console.error('[Facebook.authenticate] /me/permissions retornou erro:', permsResponse);
      throw new Error(
        `Meta /me/permissions failed: ${JSON.stringify(permsResponse.error || permsResponse)}`
      );
    }
    const { data } = permsResponse;

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetchWithTimeout(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const seenIds = new Set<string>();
    const allPages: any[] = [];

    // Orcamento total de 90s para o pages() inteiro. Se ultrapassar, retornamos
    // os resultados parciais ja coletados — evita 504 do Nginx em agencias com
    // muitas pages via Business Manager.
    const overallDeadline = Date.now() + 90000;
    const budgetExceeded = () => Date.now() > overallDeadline;

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        if (budgetExceeded()) return;
        const response = await (await fetchWithTimeout(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenIds.has(page.id)) {
              seenIds.add(page.id);
              allPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    try {
      await fetchPaginated(
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
      );
    } catch (err) {
      console.warn('[Facebook.pages] /me/accounts failed:', (err as Error)?.message);
    }

    // Also fetch pages via Business Manager API to discover pages not selected
    // during the OAuth page selection step. Atencao: o custo escala com o
    // numero de BMs selecionados no Meta App — apps com muitos BMs podem
    // estourar o rate limit (#4 "Application request limit reached"). Controle
    // no painel do Meta App selecionando apenas os BMs necessarios. O budget
    // de 90s + timeouts individuais garantem que nunca pendura indefinido.
    if (!budgetExceeded()) {
      try {
        let bizUrl:
          | string
          | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

        while (bizUrl && !budgetExceeded()) {
          const bizResponse = await (await fetchWithTimeout(bizUrl)).json();
          if (bizResponse.data) {
            for (const business of bizResponse.data) {
              if (budgetExceeded()) break;
              try {
                await fetchPaginated(
                  `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
                );
              } catch {
                // Continue with other businesses
              }

              if (budgetExceeded()) break;
              try {
                await fetchPaginated(
                  `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
                );
              } catch {
                // Continue with other businesses
              }
            }
          }
          bizUrl = bizResponse.paging?.next;
        }
      } catch {
        // Business Manager API not available for all users
      }
    }

    if (budgetExceeded()) {
      console.warn(
        `[Facebook.pages] budget de 90s estourado — retornando ${allPages.length} paginas coletadas ate agora`
      );
    }

    return allPages;
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const pageId = data.page;
    const fields = 'id,username,name,access_token,picture.type(large)';

    const searchPaginated = async (startUrl: string) => {
      let url: string | undefined = startUrl;
      while (url) {
        const response = await (await fetchWithTimeout(url)).json();
        if (response.data) {
          const page = response.data.find(
            (p: any) => String(p.id) === String(pageId)
          );
          if (page) {
            return {
              id: page.id,
              name: page.name,
              access_token: page.access_token,
              picture: page.picture?.data?.url || '',
              username: page.username,
            };
          }
        }
        url = response.paging?.next;
      }
      return null;
    };

    // 1. Check /me/accounts
    const fromAccounts = await searchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=${fields}&limit=100&access_token=${accessToken}`
    );
    if (fromAccounts) return fromAccounts;

    // 2. Check Business Manager owned_pages and client_pages.
    // Custo escala com o numero de BMs no Meta App — controle a quantidade
    // de BMs selecionados no painel do App para evitar estourar rate limit.
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetchWithTimeout(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              const fromOwned = await searchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=${fields}&limit=100&access_token=${accessToken}`
              );
              if (fromOwned) return fromOwned;
            } catch {
              // Continue with other businesses
            }

            try {
              const fromClient = await searchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=${fields}&limit=100&access_token=${accessToken}`
              );
              if (fromClient) return fromClient;
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    throw new Error('Page not found in your accounts');
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    let finalId = '';
    let finalUrl = '';
    if ((firstPost?.media?.[0]?.path?.indexOf('mp4') || -2) > -1) {
      const {
        id: videoId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/videos?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_url: firstPost?.media?.[0]?.path!,
              description: firstPost.message,
              published: true,
            }),
          },
          'upload mp4'
        )
      ).json();

      finalUrl = 'https://www.facebook.com/reel/' + videoId;
      finalId = videoId;
    } else {
      const uploadPhotos = !firstPost?.media?.length
        ? []
        : await Promise.all(
            firstPost.media.map(async (media) => {
              const { id: photoId } = await (
                await this.fetch(
                  `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      url: media.path,
                      published: false,
                    }),
                  },
                  'upload images slides'
                )
              ).json();

              return { media_fbid: photoId };
            })
          );

      const {
        id: postId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/feed?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(uploadPhotos?.length ? { attached_media: uploadPhotos } : {}),
              ...(firstPost?.settings?.url
                ? { link: firstPost.settings.url }
                : {}),
              message: firstPost.message,
              published: true,
            }),
          },
          'finalize upload'
        )
      ).json();

      finalUrl = permalink_url;
      finalId = postId;
    }

    return [
      {
        id: firstPost.id,
        postId: finalId,
        releaseURL: finalUrl,
        status: 'success',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${replyToId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...(commentPost.media?.length
              ? { attachment_url: commentPost.media[0].path }
              : {}),
            message: commentPost.message,
          }),
        },
        'add comment'
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: data.id,
        releaseURL: data.permalink_url,
        status: 'success',
      },
    ];
  }

  /**
   * Metricas da Pagina. A Meta desativou page_impressions* (2025); estas sao
   * as substitutas. Contagens diarias sao somadas; o alcance unico diario vira
   * media por dia (somar contaria a mesma pessoa varias vezes).
   * Ver docs/architecture/analytics-metricas.md.
   */
  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const { current, previous } = analyticsWindows(date);
      const base = `https://graph.facebook.com/v25.0/${id}`;
      const url = (w: AnalyticsWindow) => (metrics: string) =>
        `${base}/insights?metric=${metrics}&period=day&since=${w.since}&until=${w.until}&access_token=${accessToken}`;

      const [cur, prev, page] = await Promise.all([
        fetchMetaInsights(url(current), FACEBOOK_PAGE_METRICS),
        fetchMetaInsights(url(previous), FACEBOOK_PAGE_METRICS),
        this.readPageCounts(base, accessToken),
      ]);

      const result: AnalyticsData[] = [];
      for (const metric of FACEBOOK_PAGE_METRICS) {
        if (!cur[metric]) continue;
        const series = metaSeries(cur[metric]);
        const before = metaSeries(prev[metric]);
        const isUnique = metric === 'page_total_media_view_unique';
        const average = (s: AnalyticsData['data']) =>
          s.length ? Math.round(sumSeries(s) / s.length) : undefined;

        result.push(
          buildMetric({
            label: FACEBOOK_PAGE_LABELS[metric],
            current: isUnique ? average(series) ?? 0 : sumSeries(series),
            previous: prev[metric]
              ? isUnique
                ? average(before)
                : sumSeries(before)
              : undefined,
            series,
          })
        );
      }

      const followers = page?.followers_count ?? page?.fan_count;
      if (typeof followers === 'number') {
        result.push(
          buildMetric({ label: 'Followers', current: followers, kind: 'snapshot' })
        );
      }

      return result;
    } catch (err) {
      console.error('Error fetching Facebook analytics:', (err as Error)?.message || 'unknown error');
      return [];
    }
  }

  private async readPageCounts(
    base: string,
    accessToken: string
  ): Promise<{ followers_count?: number; fan_count?: number } | null> {
    try {
      const body = await (
        await fetch(`${base}?fields=followers_count,fan_count&access_token=${accessToken}`)
      ).json();
      return body?.error ? null : body;
    } catch {
      return null;
    }
  }

  /** Metricas de um post (acumuladas desde a publicacao); `date` nao se aplica. */
  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    // O post salvo pode ter so o id da foto/video; as metricas ficam na
    // publicacao da pagina (`<pagina>_<post>`). Validado com conta real.
    const insightsId = postId.includes('_')
      ? postId
      : `${integrationId}_${postId}`;

    try {
      const data = await fetchMetaInsights(
        (m) =>
          `https://graph.facebook.com/v25.0/${insightsId}/insights?metric=${m}&access_token=${accessToken}`,
        FACEBOOK_POST_METRICS
      );

      const result: AnalyticsData[] = [];
      for (const metric of FACEBOOK_POST_METRICS) {
        const raw = data[metric]?.values?.[0]?.value;
        const value =
          raw && typeof raw === 'object'
            ? Object.values(raw as Record<string, number>).reduce(
                (sum: number, v) => sum + (Number(v) || 0),
                0
              )
            : raw;
        if (typeof value !== 'number') continue;
        result.push(
          buildMetric({
            label: FACEBOOK_POST_LABELS[metric],
            current: value,
            kind: 'lifetime',
            date: today,
          })
        );
      }

      return result;
    } catch (err) {
      console.error('Error fetching Facebook post analytics:', (err as Error)?.message || 'unknown error');
      return [];
    }
  }
}
