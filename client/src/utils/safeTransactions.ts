import { ethers } from 'ethers';
import { SafeTransactionData } from '../types/SafeTransactionData';

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

  // Prepare EIP-712 typed data
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'verifyingContract', type: 'address' },
        { name: 'chainId', type: 'uint256' }
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
      verifyingContract: safeAddress,
      chainId
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