'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export type DmConversationStatus =
  | 'BOT_ACTIVE'
  | 'HUMAN_HANDOFF'
  | 'CLOSED';

export interface DmEscalationItem {
  id: string;
  organizationId: string;
  profileId?: string | null;
  integrationId: string;
  igAccountId: string;
  igSenderId: string;
  igSenderName?: string | null;
  status: DmConversationStatus;
  source: string;
  lastInboundAt?: string | null;
  lastBotReplyAt?: string | null;
  escalatedAt?: string | null;
  escalationReason?: string | null;
  botReplyCount: number;
  createdAt: string;
  updatedAt: string;
}

export const useDmEscalations = () => {
  const fetchApi = useFetch();
  const load = useCallback(
    async (path: string): Promise<DmEscalationItem[]> => {
      const res = await fetchApi(path);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    [fetchApi]
  );

  return useSWR<DmEscalationItem[]>('/flows/dm/escalations', load);
};

/**
 * Helper de mutacao - recebe o `mutate` da SWR por parametro para evitar
 * violacao de rules-of-hooks (mesmo padrao de `createInboxActions`).
 */
export const createDmEscalationActions = (
  fetchApi: ReturnType<typeof useFetch>,
  mutators: { mutateEscalations?: () => Promise<unknown> } = {}
) => {
  const resolve = async (id: string) => {
    const res = await fetchApi(`/flows/dm/escalations/${id}/resolve`, {
      method: 'POST',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { message?: string })?.message ||
          'Falha ao resolver a conversa'
      );
    }
    await mutators.mutateEscalations?.();
    return data;
  };

  return { resolve };
};
