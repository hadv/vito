export interface SafeTransaction {
  txHash: string;
  safe: string;
  to: string;
  value: string;
  data: string;
  operation: number;
  proposer: string;
  nonce: string;
  signatures: string[];
}

export interface SafeInfo {
  address: string;
  owners: string[];
  threshold: number;
  chainId: number;
}

export interface SafeTransactionDataPartial {
  to: string;
  value: string;
  data: string;
  operation: number;
  nonce: string;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
}