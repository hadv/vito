export interface TransactionAnalysisResult {
  /**
   * Whether the transaction is potentially harmful (malicious, suspicious, spam, or phishing)
   */
  isMalicious: boolean;
  
  /**
   * Confidence level (0-1) of the analysis
   */
  confidence: number;
  
  /**
   * Detailed explanation including the specific type of threat detected
   */
  reason: string;
}

export interface AIModelService {
  /**
   * Analyzes a transaction to determine if it's potentially harmful
   * Detects malicious, suspicious, spam, or phishing transactions
   */
  analyzeMaliciousTransaction(
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
  ): Promise<TransactionAnalysisResult>;
} 