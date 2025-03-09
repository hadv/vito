import { NetworkConfig } from '../types/NetworkConfig';

export const NETWORKS: { [key: string]: NetworkConfig } = {
  mainnet: {
    name: 'mainnet',
    chainId: 1,
    provider: `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    displayName: 'Ethereum'
  },
  arbitrum: {
    name: 'arbitrum',
    chainId: 42161,
    provider: `https://arb-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    displayName: 'Arbitrum'
  },
  sepolia: {
    name: 'sepolia',
    chainId: 11155111,
    provider: `https://eth-sepolia.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    displayName: 'Sepolia'
  }
} as const;

export const DEFAULT_NETWORK = 'mainnet';

// Helper function to get network config
export const getNetworkConfig = (networkName: string): NetworkConfig => {
  const network = NETWORKS[networkName];
  if (!network) {
    throw new Error(`Network ${networkName} not found`);
  }
  return network;
}; 