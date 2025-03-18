// Map of chain IDs to explorer base URLs
const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io', // Ethereum Mainnet
  5: 'https://goerli.etherscan.io', // Goerli Testnet
  11155111: 'https://sepolia.etherscan.io', // Sepolia Testnet
  137: 'https://polygonscan.com', // Polygon Mainnet
  80001: 'https://mumbai.polygonscan.com', // Mumbai Testnet
  42161: 'https://arbiscan.io', // Arbitrum One
  421613: 'https://goerli.arbiscan.io', // Arbitrum Goerli
  10: 'https://optimistic.etherscan.io', // Optimism
  420: 'https://goerli-optimism.etherscan.io', // Optimism Goerli
  100: 'https://gnosisscan.io', // Gnosis Chain
  56: 'https://bscscan.com', // BNB Smart Chain
  43114: 'https://snowtrace.io', // Avalanche C-Chain
  42220: 'https://celoscan.io', // Celo Mainnet
  1313161554: 'https://explorer.near.org', // Aurora Mainnet
  1313161555: 'https://explorer.testnet.aurora.dev', // Aurora Testnet
};

/**
 * Get the blockchain explorer URL for a specific chain ID
 * 
 * @param chainId The blockchain network ID
 * @returns The base URL for the explorer
 */
export function getExplorerUrl(chainId: number): string {
  return EXPLORER_URLS[chainId] || 'https://etherscan.io';
}

export default EXPLORER_URLS; 