import { Injectable } from '@nestjs/common';
import { AIModelService, TransactionAnalysisResult } from './ai-model.interface';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG } from './ai-config';

@Injectable()
export class OpenAIModelService implements AIModelService {
  private model: ChatOpenAI;
  private chain: RunnableSequence;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    this.model = new ChatOpenAI({
      modelName: AI_CONFIG.openai.modelName,
      temperature: AI_CONFIG.openai.temperature,
      maxTokens: AI_CONFIG.openai.maxTokens,
      openAIApiKey: apiKey,
    });

    const prompt = PromptTemplate.fromTemplate(`
      Analyze the following blockchain transaction for potentially harmful activity.
      Identify if this transaction appears to be malicious, suspicious, spam, or phishing.
      
      Consider these patterns:
      - Malicious: Attempts to steal funds, exploits, flash loans, or contract vulnerabilities
      - Suspicious: Unusual transaction patterns, interaction with known suspicious addresses
      - Spam: Worthless token airdrops, spam NFTs, dust attacks
      - Phishing: Attempts to trick users into revealing private keys or approving malicious contracts

      Transaction Details:
      From: {from}
      To: {to}
      Value: {value}
      Data: {data}
      Timestamp: {timestamp}

      Previous context (if available):
      {context}

      Provide your analysis in the following JSON format:
      {{
        "isMalicious": boolean, // true for any malicious, suspicious, spam, or phishing transaction
        "confidence": number (0-1),
        "reason": "detailed explanation including the specific type of threat detected (malicious/suspicious/spam/phishing)"
      }}
    `);

    this.chain = RunnableSequence.from([
      prompt,
      this.model,
      new JsonOutputParser<TransactionAnalysisResult>(),
    ]);
  }

  async analyzeMaliciousTransaction(
    transactionData: {
      from: string;
      to: string;
      value: string;
      data?: string;
      timestamp: number;
    },
    context?: {
      previousTransactions?: any[];
      accountInfo?: any;
    }
  ): Promise<TransactionAnalysisResult> {
    try {
      const result = await this.chain.invoke({
        from: transactionData.from || 'Unknown',
        to: transactionData.to || 'Unknown',
        value: transactionData.value || '0',
        data: transactionData.data || 'No data',
        timestamp: transactionData.timestamp || Date.now(),
        context: context ? JSON.stringify(context) : 'No additional context provided',
      });

      return result;
    } catch (error) {
      console.error('Error analyzing transaction:', error);
      return {
        isMalicious: false,
        confidence: 0,
        reason: 'Error analyzing transaction: ' + error.message,
      };
    }
  }
} 