/**
 * Token interface representing a token with balance information
 */
export interface Token {
  /** Token symbol (e.g., ETH, DAI) */
  symbol: string;
  /** Full token name */
  name: string;
  /** Formatted balance with proper decimal places */
  balanceFormatted: string;
  /** Raw balance in smallest units */
  balance?: string;
  /** Token contract address (ETH for native token) */
  address: string;
  /** Number of decimals for the token */
  decimals: number;
  /** USD value of the token balance, if available */
  valueUsd?: number | null;
}