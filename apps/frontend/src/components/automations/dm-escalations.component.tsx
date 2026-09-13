'use client';

import { FC, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useRouter } from 'next/navigation';
import {
  createDmEscalationActions,
  useDmEscalations,
  type DmEscalationItem,
} from './hooks/use-dm-escalations';

const formatRelative = (iso: string, t: ReturnType<typeof useT>) => {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return t('dm_escalations_just_now', 'agora mesmo');
  if (minutes < 60)
    return t('dm_escalations_minutes_ago', 'ha {{n}} min').replace(
      '{{n}}',
      String(minutes)
    );
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return t('dm_escalations_hours_ago', 'ha {{n}}h').replace(
      '{{n}}',
      String(hours)
    );
  const days = Math.floor(hours / 24);
  return t('dm_escalations_days_ago', 'ha {{n}}d').replace('{{n}}', String(days));
};

interface ItemRowProps {
  item: DmEscalationItem;
  onResolve: () => void;
  resolving: boolean;
}

const ItemRow: FC<ItemRowProps> = ({ item, onResolve, resolving }) => {
  const t = useT();
  const displayName = item.igSenderName
    ? `@${item.igSenderName}`
    : item.igSenderId;

  return (
    <div className="flex gap-[12px] p-[16px] rounded-[8px] border border-fifth bg-sixth hover:border-btnPrimary/40 transition-colors min-w-0 w-full">
      <div className="w-[44px] h-[44px] rounded-full bg-newBgColorInner flex-shrink-0 flex items-center justify-center text-customColor18 border border-fifth">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2v4l4-4h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-[8px] mb-[4px]">
          <span className="text-[14px] font-semibold text-textColor truncate">
            {displayName}
          </span>
          {item.escalatedAt && (
            <span className="text-[12px] text-customColor18 whitespace-nowrap">
              {formatRelative(item.escalatedAt, t)}
            </span>
          )}
        </div>
        <p className="text-[13px] text-customColor18 break-words">
          <span className="text-customColor18">
            {t('dm_escalations_reason_label', 'Motivo')}:
          </span>{' '}
          {item.escalationReason
            ? item.escalationReason
            : t('dm_escalations_no_reason', 'Nao informado')}
        </p>
        {item.escalatedAt && (
          <p className="text-[11px] text-customColor18 mt-[4px]">
            {new Date(item.escalatedAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-[8px] flex-shrink-0 justify-center">
        <button
          type="button"
          onClick={onResolve}
          disabled={resolving}
          className="text-[13px] px-[14px] py-[6px] rounded-[4px] bg-btnPrimary text-white hover:opacity-80 transition-opacity whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {resolving
            ? t('dm_escalations_resolving', 'Resolvendo...')
            : t('dm_escalations_action_resolve', 'Marcar como resolvido')}
        </button>
      </div>
    </div>
  );
};

export const DmEscalationsComponent: FC = () => {
  const t = useT();
  const fetchApi = useFetch();
  const toaster = useToaster();
  const router = useRouter();

  const { data: escalations, isLoading, mutate } = useDmEscalations();
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const actions = useMemo(
    () =>
      createDmEscalationActions(fetchApi, {
        mutateEscalations: () => mutate(),
      }),
    [fetchApi, mutate]
  );

  const handleResolve = async (item: DmEscalationItem) => {
    setResolvingId(item.id);
    try {
      await actions.resolve(item.id);
      toaster.show(
        t('dm_escalations_resolve_success', 'Conversa marcada como resolvida'),
        'success'
      );
    } catch (e: any) {
      toaster.show(
        e?.message ||
          t('dm_escalations_resolve_failed', 'Falha ao resolver a conversa'),
        'warning'
      );
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] p-[24px] flex-1 min-w-0">
      <div className="flex items-center gap-[12px]">
        <button
          type="button"
          onClick={() => router.push('/automacoes')}
          aria-label={t('back', 'Voltar')}
          className="text-customColor18 hover:text-textColor text-[18px]"
        >
          &larr;
        </button>
        <div>
          <h1 className="text-[20px] font-semibold text-textColor">
            {t('dm_escalations_title', 'Atendimento humano')}
          </h1>
          <p className="text-[14px] text-customColor18 mt-[4px]">
            {t(
              'dm_escalations_description',
              'Conversas por mensagem direta que a IA encaminhou para um atendente humano. Responda diretamente no Instagram e marque como resolvido aqui.'
            )}
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-[40px]">
          <p className="text-[13px] text-customColor18">
            {t('loading', 'Carregando...')}
          </p>
        </div>
      )}

      {!isLoading && (!escalations || escalations.length === 0) && (
        <div className="flex flex-col items-center justify-center py-[64px] text-customColor18 border border-fifth rounded-[8px] bg-sixth">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mb-[12px] opacity-50"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-[14px]">
            {t(
              'dm_escalations_empty',
              'Nenhuma conversa aguardando atendimento humano'
            )}
          </p>
        </div>
      )}

      {!isLoading && escalations && escalations.length > 0 && (
        <div className="flex flex-col gap-[12px] min-w-0">
          {escalations.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onResolve={() => handleResolve(item)}
              resolving={resolvingId === item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};
