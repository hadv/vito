import { NetworkConfig } from '../types/network';

// Import contract artifacts
import SafeTxPoolArtifact from '../../../contracts/out/SafeTxPool.sol/SafeTxPool.json' assert { type: 'json' };

export const SAFE_TX_POOL_ABI = SafeTxPoolArtifact.abi;

// Contract addresses per network
export const CONTRACT_ADDRESSES: { [key: string]: { safeTxPool: string } } = {
  mainnet: {
    safeTxPool: '0x...' // Add mainnet address
  },
  arbitrum: {
    safeTxPool: '0x...' // Add arbitrum address
  },
  sepolia: {
    safeTxPool: '0xa2ad21dc93B362570D0159b9E3A2fE5D8ecA0424' // Sepolia SafeTxPool address
  }
};

export function getContractAddress(network: NetworkConfig): { safeTxPool: string } {
  // First try to get addresses for the network name
  const addresses = CONTRACT_ADDRESSES[network.name.toLowerCase()];
  
  if (!addresses) {
    // For development networks, default to sepolia addresses
    if (network.chainId === 11155111 || network.name.includes('sepolia')) {
      return CONTRACT_ADDRESSES.sepolia;
    }
    
    // For mainnet or mainnet forks
    if (network.chainId === 1 || network.name.includes('mainnet')) {
      return CONTRACT_ADDRESSES.mainnet;
    }
    
    // For arbitrum networks
    if (network.chainId === 42161 || network.name.includes('arbitrum')) {
      return CONTRACT_ADDRESSES.arbitrum;
    }
    
    throw new Error(`No contract addresses found for network ${network.name} (chainId: ${network.chainId})`);
  }
  
  return addresses;
} 