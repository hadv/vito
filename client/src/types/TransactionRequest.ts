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