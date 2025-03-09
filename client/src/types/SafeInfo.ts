export interface SafeInfo {
  owners: string[];
  threshold: number;
  balance: string;
  ensNames: { [address: string]: string | null };
  network?: string;
  chainId?: number;
  safeAddress?: string;
  isOwner?: boolean;
  nonce?: number;
} 