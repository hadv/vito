export interface SafeInfo {
  owners: string[];
  threshold: number;
  balance: string;
  ensNames: { [address: string]: string | null };
  network?: string;
  chainId?: number;
  safeAddress?: string;
  isOwner?: boolean;
  nonce?: number;
}

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