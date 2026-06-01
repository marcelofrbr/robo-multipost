import { DmBotService } from './dm-bot.service';
import { AiClientFactory } from '@gitroom/nestjs-libraries/ai/ai-client.factory';
import { KnowledgeService } from '@gitroom/nestjs-libraries/database/prisma/knowledge/knowledge.service';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MockProxy } from 'jest-mock-extended';
import { generateObject } from 'ai';

// KnowledgeService importa transitivamente @mastra/pg e @mastra/rag (ESM)
// que o ts-jest nao transpila. Aqui so precisamos do tipo para createMock,
// entao stubamos o modulo inteiro com uma classe vazia.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/knowledge/knowledge.service',
  () => ({ KnowledgeService: class {} })
);

jest.mock('ai', () => ({
  generateObject: jest.fn(),
  generateText: jest.fn(),
}));

const mockedGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>;

describe('DmBotService', () => {
  let service: DmBotService;
  let factory: MockProxy<AiClientFactory> & AiClientFactory;
  let knowledge: MockProxy<KnowledgeService> & KnowledgeService;
  let profile: MockProxy<ProfileService> & ProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    factory = createMock<AiClientFactory>();
    knowledge = createMock<KnowledgeService>();
    profile = createMock<ProfileService>();
    service = new DmBotService(factory, knowledge, profile);
  });

  describe('generateReply', () => {
    it('deve escalar sem chamar IA nem RAG quando usuario pede atendimento humano', async () => {
      // ACT
      const result = await service.generateReply({
        orgId: 'org-1',
        profileId: 'p-1',
        integrationId: 'int-1',
        history: [],
        userMessage: 'quero falar com um atendente por favor',
      });

      // ASSERT
      expect(result).toEqual({
        reply: '',
        escalate: true,
        reason: 'usuario pediu atendimento humano',
      });
      expect(factory.text).not.toHaveBeenCalled();
      expect(knowledge.query).not.toHaveBeenCalled();
      expect(mockedGenerateObject).not.toHaveBeenCalled();
    });

    it('deve consultar a base de conhecimento e retornar resposta no caminho feliz', async () => {
      // ARRANGE
      knowledge.query.mockResolvedValue([
        {
          score: 0.9,
          text: 'Horario de funcionamento das 9h as 18h',
          filename: 'faq.txt',
        },
      ]);
      factory.text.mockResolvedValue({
        provider: 'openai',
        model: 'model-principal' as any,
        modelId: 'gpt-5.5',
        fallbackModel: null,
        fallbackModelId: null,
        options: {},
        credentialId: 'cred-1',
      });
      mockedGenerateObject.mockResolvedValue({
        object: {
          reply: 'Funcionamos das 9h as 18h.',
          escalate: false,
          reason: 'ok',
        },
      } as any);

      // ACT
      const result = await service.generateReply({
        orgId: 'org-1',
        profileId: 'p-1',
        integrationId: 'int-1',
        history: [{ role: 'user', text: 'oi' }],
        userMessage: 'qual o horario de atendimento?',
      });

      // ASSERT
      expect(knowledge.query).toHaveBeenCalledWith(
        'p-1',
        'qual o horario de atendimento?',
        4
      );
      expect(result.escalate).toBe(false);
      expect(result.reply).toBe('Funcionamos das 9h as 18h.');
    });

    it('deve escalar com reply vazio quando geracao falha nas duas tentativas (fail-safe)', async () => {
      // ARRANGE
      knowledge.query.mockResolvedValue([]);
      factory.text.mockResolvedValue({
        provider: 'openai',
        model: 'model-principal' as any,
        modelId: 'gpt-5.5',
        fallbackModel: 'model-fallback' as any,
        fallbackModelId: 'gpt-5-mini',
        options: {},
        credentialId: 'cred-1',
      });
      mockedGenerateObject.mockRejectedValue(new Error('boom'));

      // ACT
      const result = await service.generateReply({
        orgId: 'org-1',
        profileId: 'p-1',
        integrationId: 'int-1',
        history: [],
        userMessage: 'tem desconto?',
      });

      // ASSERT
      expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        reply: '',
        escalate: true,
        reason: 'baixa confianca (falha na geracao)',
      });
    });
  });
});
