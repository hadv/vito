import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OpenAIModelService } from './openai-model.service';
import { GeminiModelService } from './gemini-model.service';
import { TransactionAnalysisService } from '../transaction-analysis.service';
import { AI_CONFIG } from './ai-config';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'AIModelService',
      useFactory: (configService: ConfigService) => {
        // This factory allows us to switch AI providers based on configuration
        return AI_CONFIG.provider === 'gemini' 
          ? new GeminiModelService(configService) 
          : new OpenAIModelService(configService);
      },
      inject: [ConfigService],
    },
    TransactionAnalysisService,
  ],
  exports: [TransactionAnalysisService],
})
export class AIModule {} 