export interface TransactionRequest {
  topic: string;
  chainId: string;
  request: {
    id: number;
    jsonrpc: string;
    method: string;
    params: [{
      from: string;
      to: string;
      data: string;
      value: string;
      gasLimit: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
      type: string;
    }];
  };
}

export interface BlockchainTransaction {
  id: string;
  timestamp: number;
  txHash: string;
  value: string;
  nonce: number;
  to: string;
  from?: string;
  data: string;
  operation: number;
  safeTxHash: string;
  executor?: string;
  executionDate?: string;
  executedTxHash?: string;
  confirmations?: {
    owner: string;
    signature: string;
    submissionDate: string;
  }[];
  isExecuted: boolean;
  dataDecoded?: {
    method: string;
    parameters?: Array<{
      name: string;
      type: string;
      value: any;
    }>;
  };
  tokenInfo?: {
    address: string;
    symbol: string;
    decimals: number;
    name: string;
  };
  stateChanges?: {
    tokenAddress: string;
    tokenSymbol: string;
    tokenDecimals: number;
    from: string;
    to: string;
    value: string;
    isStateChange: boolean;
  }[];
}