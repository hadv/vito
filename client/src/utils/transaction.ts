import { JsonRpcProvider } from 'ethers';
import { TransactionRequest } from '../types/TransactionRequest';

export async function prepareTransactionRequest({
  provider,
  signerAddress,
  sessionTopic,
  selectedNetwork,
  contractAddress,
  encodedTxData,
  requestId
}: {
  provider: JsonRpcProvider;
  signerAddress: string;
  sessionTopic: string;
  selectedNetwork: { chainId: number };
  contractAddress: string;
  encodedTxData: string;
  requestId: number;
}): Promise<TransactionRequest> {
  // Get fee data from the provider
  const feeData = await provider.getFeeData();
  console.log('Current fee data:', feeData);
  
  // First estimate the gas
  const gasEstimate = await provider.estimateGas({
    from: signerAddress,
    to: contractAddress,
    data: encodedTxData,
    value: "0x0"
  });

  // Add 20% buffer to the estimate for safety
  const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100);
  console.log('Estimated gas:', gasEstimate.toString(), 'Using gas limit:', gasLimit.toString());

  // Prepare the transaction request with all necessary parameters
  return {
    topic: sessionTopic,
    chainId: `eip155:${selectedNetwork.chainId}`,
    request: {
      id: requestId,
      jsonrpc: '2.0',
      method: 'eth_sendTransaction',
      params: [{
        from: signerAddress,
        to: contractAddress,
        data: encodedTxData,
        value: "0x0",
        gasLimit: `0x${gasLimit.toString()}`,
        maxFeePerGas: feeData.maxFeePerGas ? `0x${feeData.maxFeePerGas.toString(16)}` : "0x2540be400",  // 10 Gwei
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? `0x${feeData.maxPriorityFeePerGas.toString(16)}` : "0x3b9aca00",  // 1 Gwei
        type: "0x2"  // EIP-1559 transaction type
      }]
    }
  };
} 