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
      // Extract internal transactions if they exist
      const internalTransactions = transaction.internalTxs || [];
      
      // For Safe wallet transactions, provide the safe address in context
      // This helps the AI model understand these are legitimate smart contract wallet transactions
      const isSafeWallet = transaction.to && (
        // Typical Safe wallet module addresses often contain these signatures
        transaction.to.toLowerCase().includes('safe') ||
        transaction.to.toLowerCase().includes('gnosis') ||
        transaction.data?.includes('multisig') ||
        // Check if this is a known Safe proxy contract
        (context?.safeInfo?.isProxy === true)
      );
      
      const analyzedTx = {
        from: transaction.from,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
        timestamp: transaction.timestamp || Date.now(),
        internalTransactions: internalTransactions.map(tx => ({
          from: tx.from,
          to: tx.to,
          value: tx.value,
          data: tx.data || ''
        }))
      };
      
      // Prepare context with Safe wallet information
      const enrichedContext = {
        ...context,
        safeAddress: context?.safeAddress || transaction.from,
        isSafeWallet: isSafeWallet,
        contractType: isSafeWallet ? 'safe-wallet' : 'unknown'
      };

      // Run the AI analysis
      const analysisResult = await this.aiModel.analyzeMaliciousTransaction(
        analyzedTx,
        enrichedContext
      );

      return {
        ...transaction,
        analysis: {
          isMalicious: analysisResult.isMalicious,
          confidence: analysisResult.confidence,
          reason: analysisResult.reason,
          internalTransactions: analysisResult.internalTransactions,
          isSafeWallet: isSafeWallet
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
          isSafeWallet: false
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