/**
 * Truncates an Ethereum address to a shorter format for display purposes.
 * Shows the first 6 and last 6 characters of the address.
 * @param address - The Ethereum address to truncate
 * @returns The truncated address string
 */
export const truncateAddress = (address: string): string => {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}; 