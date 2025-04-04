export interface NetworkConfig {
  name: string;
  chainId: number;
  provider: string;
  displayName: string;
  nativeTokenName: string;
  rpcUrl?: string;
  safeService?: string;
  blockExplorer?: string;
  symbol?: string;
  isTestnet?: boolean;
}