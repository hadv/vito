import { NetworkConfig } from '../types/network';

export const NETWORKS: { [key: string]: NetworkConfig } = {
  mainnet: {
    name: 'mainnet',
    displayName: 'Ethereum Mainnet',
    chainId: 1,
    provider: `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
  },
  arbitrum: {
    name: 'arbitrum',
    displayName: 'Arbitrum One',
    chainId: 42161,
    provider: `https://arb-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
  },
  sepolia: {
    name: 'sepolia',
    displayName: 'Sepolia Testnet',
    chainId: 11155111,
    provider: `https://eth-sepolia.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
  }
} as const;

export const DEFAULT_NETWORK = 'sepolia';

// Helper function to get network config
export function getNetworkConfig(networkName: string): NetworkConfig {
  const network = NETWORKS[networkName];
  if (!network) {
    throw new Error(`Network ${networkName} not found`);
  }
  return network;
} 