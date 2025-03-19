import { ethers } from 'ethers';

/**
 * Truncates an Ethereum address to a shorter format for display purposes.
 * Shows the first 6 and last 6 characters of the address.
 * @param address - The Ethereum address to truncate
 * @returns The truncated address string
 */
export const truncateAddress = (address: string): string => {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
};

/**
 * Resolves an Ethereum address to its corresponding ENS name.
 * @param address - The Ethereum address to resolve
 * @param provider - An ethers.js provider
 * @returns The ENS name if found, null otherwise
 */
export async function resolveEnsName(
  address: string,
  provider: ethers.JsonRpcProvider
): Promise<string | null> {
  try {
    const ensName = await provider.lookupAddress(address);
    return ensName;
  } catch (error) {
    console.error(`Failed to resolve ENS for ${address}:`, error);
    return null;
  }
} 