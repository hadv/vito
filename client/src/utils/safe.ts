import { ethers } from 'ethers';

/**
 * Get the current nonce from a Safe contract
 * @param safeAddress The address of the Safe contract
 * @param provider An ethers.js provider
 * @returns The nonce as a string
 */
export async function getSafeNonce(
  safeAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<string> {
  // Safe contract ABI for nonce function
  const safeAbi = [
    "function nonce() view returns (uint256)"
  ];
  
  // Create contract instance
  const safeContract = new ethers.Contract(safeAddress, safeAbi, provider);
  
  try {
    // Get nonce from contract
    const nonce = await safeContract.nonce();
    return nonce.toString();
  } catch (error) {
    console.error('Error getting Safe nonce:', error);
    throw new Error('Failed to get Safe nonce');
  }
}

/**
 * Get a transaction hash from the Safe contract
 * @param to Destination address
 * @param value Transaction value in wei
 * @param data Transaction data
 * @param operation Operation type (0 for call, 1 for delegatecall)
 * @param nonce Current Safe nonce
 * @param safeAddress The address of the Safe contract
 * @param provider An ethers.js provider
 * @returns The transaction hash
 */
export async function getSafeTxHashFromContract(
  to: string,
  value: string,
  data: string,
  operation: number,
  nonce: string,
  safeAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<string> {
  // Safe contract ABI for getTransactionHash function
  const safeAbi = [
    "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)"
  ];
  
  // Create contract instance
  const safeContract = new ethers.Contract(safeAddress, safeAbi, provider);
  
  try {
    // Get hash from contract
    const hash = await safeContract.getTransactionHash(
      to,
      value,
      data,
      operation,
      '0', // safeTxGas
      '0', // baseGas
      '0', // gasPrice
      '0x0000000000000000000000000000000000000000', // gasToken
      '0x0000000000000000000000000000000000000000', // refundReceiver
      nonce
    );
    return hash;
  } catch (error) {
    console.error('Error getting Safe transaction hash:', error);
    throw new Error('Failed to get Safe transaction hash');
  }
} 