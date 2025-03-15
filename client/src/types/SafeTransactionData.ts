export interface SafeTransactionData {
  to: string;
  value: string;
  data: string;
  operation: number;
  nonce: string;
  safeTxGas?: string;
  baseGas?: string;
  gasPrice?: string;
  gasToken?: string;
  refundReceiver?: string;
}

export interface SafeTransaction extends SafeTransactionData {
  txHash: string;
  safe: string;
  proposer: string;
  signatures: string[];
} 