'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useRouter } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type TriggerType =
  | 'comment_on_post'
  | 'story_reply'
  | 'repost_story'
  | 'direct_message';

interface TriggerOption {
  id: TriggerType;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
}

const TRIGGERS: TriggerOption[] = [
  {
    id: 'comment_on_post',
    titleKey: 'nova_automacao_sidebar_comment',
    titleFallback: 'Comentario em Feed/Reels',
    descKey: 'nova_automacao_sidebar_comment_desc',
    descFallback: 'Responda comentarios em posts de feed e reels',
  },
  {
    id: 'story_reply',
    titleKey: 'nova_automacao_sidebar_story',
    titleFallback: 'Resposta ao Story',
    descKey: 'nova_automacao_sidebar_story_desc',
    descFallback: 'Envie uma DM quando alguem responder seu story',
  },
  {
    id: 'repost_story',
    titleKey: 'nova_automacao_sidebar_repost',
    titleFallback: 'Repost de Story',
    descKey: 'nova_automacao_sidebar_repost_desc',
    descFallback:
      'Monitore stories do Instagram e republique em TikTok e YouTube Shorts',
  },
  {
    id: 'direct_message',
    titleKey: 'nova_automacao_sidebar_dm_bot',
    titleFallback: 'Atendimento por DM (IA)',
    descKey: 'nova_automacao_sidebar_dm_bot_desc',
    descFallback:
      'Responda automaticamente as mensagens diretas com IA e escale para um humano quando preciso',
  },
];

export const NovaAutomacaoModal: FC<Props> = ({ open, onClose, onCreated }) => {
  const t = useT();
  const fetchApi = useFetch();
  const router = useRouter();
  const toaster = useToaster();
  const { data: integrations } = useIntegrationList();

  const [activeTrigger, setActiveTrigger] = useState<TriggerType>('comment_on_post');
  const [flowName, setFlowName] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [creating, setCreating] = useState(false);
  const [dmBotEnabled, setDmBotEnabled] = useState(true);
  const [dmBotFallback, setDmBotFallback] = useState('');
  const [webhookCheck, setWebhookCheck] = useState<{
    loading: boolean;
    ok?: boolean;
    error?: string;
  }>({ loading: false });

  useEffect(() => {
    if (!open) {
      setFlowName('');
      setIntegrationId('');
      setActiveTrigger('comment_on_post');
      setWebhookCheck({ loading: false });
      setDmBotEnabled(true);
      setDmBotFallback('');
    }
  }, [open]);

  useEffect(() => {
    if (!integrationId) {
      setWebhookCheck({ loading: false });
      return;
    }
    setWebhookCheck({ loading: true });
    fetchApi(`/flows/integrations/${integrationId}/webhook-status`)
      .then((r) => r.json())
      .then((data) => {
        setWebhookCheck({ loading: false, ok: data.ok, error: data.error });
      })
      .catch(() => {
        setWebhookCheck({
          loading: false,
          ok: false,
          error: t(
            'webhook_check_failed',
            'Nao foi possivel verificar o webhook'
          ),
        });
      });
  }, [integrationId, fetchApi, t]);

  const instagramIntegrations = useMemo(() => {
    if (!Array.isArray(integrations)) return [];
    return integrations.filter((i: any) => i.identifier === 'instagram');
  }, [integrations]);

  const canCreate =
    activeTrigger === 'repost_story'
      ? true
      : activeTrigger === 'direct_message'
      ? !!integrationId && !creating
      : !!flowName.trim() && !!integrationId && !!webhookCheck.ok && !creating;

  const handleCreate = async () => {
    if (activeTrigger === 'repost_story') {
      onClose();
      router.push('/automacoes/repost/nova');
      return;
    }
    if (activeTrigger === 'direct_message') {
      if (!canCreate) return;
      setCreating(true);
      try {
        const response = await fetchApi('/flows/dm/bot', {
          method: 'POST',
          body: JSON.stringify({
            integrationId,
            enabled: dmBotEnabled,
            fallbackMessage: dmBotFallback.trim() || undefined,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          toaster.show(
            body.message ||
              t('dm_bot_save_failed', 'Falha ao salvar o bot de atendimento'),
            'warning'
          );
          return;
        }
        toaster.show(
          t('dm_bot_saved', 'Bot de atendimento por DM salvo com sucesso'),
          'success'
        );
        onCreated?.();
        onClose();
        router.push('/automacoes');
      } catch {
        toaster.show(
          t('dm_bot_save_failed', 'Falha ao salvar o bot de atendimento'),
          'warning'
        );
      } finally {
        setCreating(false);
      }
      return;
    }
    if (!canCreate) return;
    setCreating(true);
    try {
      const response = await fetchApi('/flows', {
        method: 'POST',
        body: JSON.stringify({
          name: flowName.trim(),
          integrationId,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toaster.show(
          body.message || t('failed_to_create_flow', 'Falha ao criar automacao'),
          'warning'
        );
        return;
      }
      const created = await response.json();
      toaster.show(
        t('flow_created', 'Automacao criada com sucesso'),
        'success'
      );
      onCreated?.();
      onClose();
      const typeParam = activeTrigger === 'story_reply' ? 'story' : 'comment';
      router.push(`/automacoes/${created.id}/wizard?type=${typeParam}`);
    } catch {
      toaster.show(
        t('failed_to_create_flow', 'Falha ao criar automacao'),
        'warning'
      );
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-[16px]">
      <div className="bg-newBgColorInner border border-fifth rounded-[8px] w-full max-w-[960px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-[24px] py-[16px] border-b border-fifth">
          <div>
            <h2 className="text-[18px] font-semibold text-textColor">
              {t('nova_automacao_title', 'Nova Automacao')}
            </h2>
            <p className="text-[12px] text-customColor18 mt-[2px]">
              {t(
                'nova_automacao_subtitle',
                'Escolha um gatilho para sua automacao do Instagram'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-customColor18 hover:text-textColor text-[20px] leading-none px-[8px]"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[240px] border-r border-fifth p-[12px] flex flex-col gap-[4px] overflow-y-auto bg-sixth/50">
            <div className="text-[11px] uppercase tracking-wide text-customColor18 px-[8px] py-[6px]">
              {t('nova_automacao_by_trigger', 'Por gatilho')}
            </div>
            {TRIGGERS.map((trigger) => (
              <button
                key={trigger.id}
                onClick={() => setActiveTrigger(trigger.id)}
                className={`text-left px-[12px] py-[10px] rounded-[4px] text-[13px] font-medium transition-colors ${
                  activeTrigger === trigger.id
                    ? 'bg-btnPrimary/15 text-textColor border border-btnPrimary/40'
                    : 'text-customColor18 hover:bg-boxHover border border-transparent'
                }`}
              >
                {t(trigger.titleKey, trigger.titleFallback)}
              </button>
            ))}
          </div>

          {/* Main */}
          <div className="flex-1 overflow-y-auto p-[24px]">
            <div className="mb-[20px]">
              <h3 className="text-[14px] font-semibold text-textColor mb-[4px]">
                {t(
                  TRIGGERS.find((x) => x.id === activeTrigger)!.titleKey,
                  TRIGGERS.find((x) => x.id === activeTrigger)!.titleFallback
                )}
              </h3>
              <p className="text-[12px] text-customColor18">
                {t(
                  TRIGGERS.find((x) => x.id === activeTrigger)!.descKey,
                  TRIGGERS.find((x) => x.id === activeTrigger)!.descFallback
                )}
              </p>
            </div>

            {activeTrigger === 'direct_message' ? (
              <div className="flex flex-col gap-[14px] max-w-[520px]">
                <p className="text-[13px] text-textColor leading-[1.6]">
                  {t(
                    'dm_bot_modal_intro',
                    'Ative um bot que responde automaticamente as mensagens diretas da conta selecionada e transfere para um humano quando necessario.'
                  )}
                </p>

                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] text-textColor">
                    {t('select_instagram_account', 'Conta do Instagram')}
                  </label>
                  {instagramIntegrations.length === 0 ? (
                    <p className="text-[12px] text-customColor19">
                      {t(
                        'no_instagram_connected',
                        'Nenhuma conta do Instagram conectada. Conecte uma em Integracoes.'
                      )}
                    </p>
                  ) : (
                    <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] flex items-center">
                      <select
                        className="h-full bg-transparent outline-none flex-1 text-[14px] text-textColor px-[16px] appearance-none"
                        value={integrationId}
                        onChange={(e) => setIntegrationId(e.target.value)}
                      >
                        <option value="">
                          {t('select_account', 'Selecione uma conta...')}
                        </option>
                        {instagramIntegrations.map((ig: any) => (
                          <option key={ig.id} value={ig.id}>
                            {ig.name || ig.display || ig.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-[12px] p-[12px] rounded-[8px] border border-fifth bg-sixth/60">
                  <div>
                    <div className="text-[13px] text-textColor">
                      {t('dm_bot_enable', 'Ativar bot de atendimento por DM')}
                    </div>
                    <div className="text-[11px] text-customColor18 mt-[2px]">
                      {t(
                        'dm_bot_enable_hint',
                        'Quando desligado, o bot fica pausado e nao responde as mensagens.'
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={dmBotEnabled}
                    onClick={() => setDmBotEnabled((v) => !v)}
                    className={`relative w-[44px] h-[24px] rounded-full transition-colors flex-shrink-0 ${
                      dmBotEnabled ? 'bg-btnPrimary' : 'bg-customColor18/30'
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[20px] h-[20px] rounded-full bg-white transition-all ${
                        dmBotEnabled ? 'left-[22px]' : 'left-[2px]'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] text-textColor">
                    {t(
                      'dm_bot_fallback_label',
                      'Mensagem de fallback (quando escalar para humano)'
                    )}
                  </label>
                  <textarea
                    value={dmBotFallback}
                    onChange={(e) => setDmBotFallback(e.target.value)}
                    rows={3}
                    placeholder={t(
                      'dm_bot_fallback_placeholder',
                      'Um momento! Vou te transferir para um atendente humano que vai continuar essa conversa.'
                    )}
                    className="w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[13px] text-textColor px-[14px] py-[10px] outline-none resize-none"
                  />
                  <span className="text-[11px] text-customColor18">
                    {t(
                      'dm_bot_fallback_hint',
                      'Enviada ao usuario quando o bot transferir a conversa para um atendente humano.'
                    )}
                  </span>
                </div>
              </div>
            ) : activeTrigger === 'repost_story' ? (
              <div className="flex flex-col gap-[12px] max-w-[520px] rounded-[4px] border border-fifth bg-sixth/60 p-[16px]">
                <p className="text-[13px] text-textColor leading-[1.6]">
                  {t(
                    'repost_modal_intro',
                    'Crie uma regra que monitora os stories publicados em uma conta Instagram Business e republica automaticamente em TikTok e YouTube Shorts.'
                  )}
                </p>
                <ul className="text-[12px] text-customColor18 list-disc pl-[18px] space-y-[4px]">
                  <li>
                    {t(
                      'repost_modal_bullet_interval',
                      'Polling a cada 5 min a 6 h por regra (default 15 min).'
                    )}
                  </li>
                  <li>
                    {t(
                      'repost_modal_bullet_calendar',
                      'Cada repost aparece no calendário como um Post em fila.'
                    )}
                  </li>
                  <li>
                    {t(
                      'repost_modal_bullet_images',
                      'V1 repostará apenas vídeos. Fotos são puladas automaticamente.'
                    )}
                  </li>
                </ul>
              </div>
            ) : (
            <div className="flex flex-col gap-[14px] max-w-[520px]">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] text-textColor">
                  {t('flow_name', 'Nome')}
                </label>
                <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] flex items-center">
                  <input
                    type="text"
                    className="h-full bg-transparent outline-none flex-1 text-[14px] text-textColor px-[16px]"
                    placeholder={t(
                      'flow_name_placeholder',
                      'Minha automacao do Instagram'
                    )}
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] text-textColor">
                  {t('select_instagram_account', 'Conta do Instagram')}
                </label>
                {instagramIntegrations.length === 0 ? (
                  <p className="text-[12px] text-customColor19">
                    {t(
                      'no_instagram_connected',
                      'Nenhuma conta do Instagram conectada. Conecte uma em Integracoes.'
                    )}
                  </p>
                ) : (
                  <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] flex items-center">
                    <select
                      className="h-full bg-transparent outline-none flex-1 text-[14px] text-textColor px-[16px] appearance-none"
                      value={integrationId}
                      onChange={(e) => setIntegrationId(e.target.value)}
                    >
                      <option value="">
                        {t('select_account', 'Selecione uma conta...')}
                      </option>
                      {instagramIntegrations.map((ig: any) => (
                        <option key={ig.id} value={ig.id}>
                          {ig.name || ig.display || ig.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {integrationId && (
                <div className="flex flex-col gap-[4px]">
                  {webhookCheck.loading ? (
                    <p className="text-[12px] text-customColor18">
                      {t('checking_webhook', 'Verificando webhook...')}
                    </p>
                  ) : webhookCheck.ok ? (
                    <p className="text-[12px] text-customColor42">
                      {t('webhook_ok', 'Webhook configurado corretamente')}
                    </p>
                  ) : webhookCheck.error ? (
                    <div className="rounded-[4px] border border-customColor13/40 bg-customColor13/10 p-[12px]">
                      <p className="text-[12px] text-customColor13 whitespace-pre-wrap leading-[1.5]">
                        {webhookCheck.error}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-[8px] px-[24px] py-[14px] border-t border-fifth">
          <button
            onClick={onClose}
            className="rounded-[4px] border border-fifth bg-btnSimple px-[16px] py-[8px] text-[13px] text-textColor hover:opacity-80"
          >
            {t('cancel', 'Cancelar')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="rounded-[4px] bg-btnPrimary px-[16px] py-[8px] text-[13px] text-white hover:opacity-80 disabled:opacity-50"
          >
            {creating
              ? t('creating_flow', 'Criando...')
              : activeTrigger === 'repost_story'
              ? t('repost_open_wizard', 'Abrir wizard de Repost')
              : activeTrigger === 'direct_message'
              ? t('dm_bot_save', 'Salvar bot de atendimento')
              : t('create_and_continue', 'Criar e continuar')}
          </button>
        </div>
      </div>
    </div>
  );
};
