import { NetworkConfig } from '../types/network';

export const NETWORKS: { [key: string]: NetworkConfig } = {
  mainnet: {
    name: 'mainnet',
    displayName: 'Ethereum Mainnet',
    chainId: 1,
    provider: `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    nativeTokenName: 'Ethereum'
  },
  arbitrum: {
    name: 'arbitrum',
    displayName: 'Arbitrum One',
    chainId: 42161,
    provider: `https://arb-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    nativeTokenName: 'Arbitrum ETH'
  },
  sepolia: {
    name: 'sepolia',
    displayName: 'Sepolia Testnet',
    chainId: 11155111,
    provider: `https://eth-sepolia.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`,
    nativeTokenName: 'Sepolia Ether'
  }
} as const;

export const DEFAULT_NETWORK = 'sepolia';

// Helper function to get network config
export function getNetworkConfig(name: string): NetworkConfig {
  return NETWORKS[name] || NETWORKS[DEFAULT_NETWORK];
} 