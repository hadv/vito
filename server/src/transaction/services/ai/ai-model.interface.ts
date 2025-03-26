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

  /**
   * Analysis of internal transactions, if any were found
   */
  internalTransactions?: {
    isMalicious: boolean;
    confidence: number;
    reason: string;
    transaction: {
      from: string;
      to: string;
      value: string;
    };
  }[];
}

export interface AIModelService {
  /**
   * Analyzes a transaction to determine if it's potentially harmful
   * Detects malicious, suspicious, spam, or phishing transactions
   * Also analyzes internal transactions if provided
   */
  analyzeMaliciousTransaction(
    transactionData: {
      from: string;
      to: string;
      value: string;
      data?: string;
      timestamp: number;
      internalTransactions?: Array<{
        from: string;
        to: string;
        value: string;
        data?: string;
      }>;
    },
    context?: {
      previousTransactions?: any[];
      accountInfo?: any;
      safeAddress?: string; // To identify which internal txs are related to the safe
    }
  ): Promise<TransactionAnalysisResult>;
} 