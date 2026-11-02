export const dynamic = 'force-dynamic';
import { DmEscalationsComponent } from '@gitroom/frontend/components/automations/dm-escalations.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Atendimento humano',
  description:
    'Conversas por mensagem direta que a IA encaminhou para um atendente humano',
};

export default async function Index() {
  return (
    <div className="bg-newBgColorInner flex-1 flex-col flex min-w-0">
      <DmEscalationsComponent />
    </div>
  );
}
