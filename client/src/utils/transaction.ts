import { JsonRpcProvider, ethers } from 'ethers';
import { TransactionRequest } from '../types/transaction';
import { SafeTransactionData } from '../types/safe';

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

/**
 * Calculates the Safe transaction hash according to EIP-712
 * @param transaction The transaction data
 * @param safeAddress The address of the Safe contract
 * @param chainId The chain ID of the network
 * @returns The calculated Safe transaction hash
 */
export const calculateSafeTxHash = (
  transaction: SafeTransactionData,
  safeAddress: string,
  chainId: number
): string => {
  // Prepare transaction object with default values
  const txData = {
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
    operation: transaction.operation,
    nonce: transaction.nonce,
    safeTxGas: transaction.safeTxGas || '0',
    baseGas: transaction.baseGas || '0',
    gasPrice: transaction.gasPrice || '0',
    gasToken: transaction.gasToken || '0x0000000000000000000000000000000000000000',
    refundReceiver: transaction.refundReceiver || '0x0000000000000000000000000000000000000000',
  };

  // Prepare EIP-712 typed data with Safe's domain separator
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' }
      ]
    },
    primaryType: 'SafeTx',
    domain: {
      chainId,
      verifyingContract: safeAddress
    },
    message: txData
  };

  // Calculate the safeTxHash using ethers.js
  return ethers.TypedDataEncoder.hash(
    typedData.domain,
    { SafeTx: typedData.types.SafeTx },
    typedData.message
  );
}; 