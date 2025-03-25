import { Injectable, Inject } from '@nestjs/common';
import { AIModelService } from './ai/ai-model.interface';
import { OpenAIModelService } from './ai/openai-model.service';

@Injectable()
export class TransactionAnalysisService {
  constructor(
    @Inject('AIModelService')
    private aiModel: AIModelService
  ) {}

  async analyzeMaliciousTransaction(transaction: any, context?: any) {
    try {
      const analysisResult = await this.aiModel.analyzeMaliciousTransaction(
        {
          from: transaction.from,
          to: transaction.to,
          value: transaction.value,
          data: transaction.data,
          timestamp: transaction.timestamp || Date.now(),
        },
        context
      );

      return {
        ...transaction,
        analysis: {
          isMalicious: analysisResult.isMalicious,
          confidence: analysisResult.confidence,
          reason: analysisResult.reason,
        },
      };
    } catch (error) {
      console.error('Error in transaction analysis:', error);
      return {
        ...transaction,
        analysis: {
          isMalicious: false,
          confidence: 0,
          reason: 'Analysis failed',
        },
      };
    }
  }

  async analyzeBatchTransactions(transactions: any[], context?: any) {
    const results = await Promise.all(
      transactions.map(tx => this.analyzeMaliciousTransaction(tx, context))
    );
    return results;
  }
} 