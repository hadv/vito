import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';

// ERC20 ABI for token interactions
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceFormatted: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface TokenPriceInfo {
  address: string;
  priceUsd: number;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  // In-memory cache of token prices
  private tokenPrices: Map<string, TokenPriceInfo> = new Map();

  // In-memory cache of token metadata (name, symbol, decimals)
  private tokenMetadata: Map<string, { name: string; symbol: string; decimals: number }> = new Map();

  // Popular token addresses for different networks
  private popularTokens: Record<number, string[]> = {
    1: [ // Ethereum Mainnet
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
      '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
    ],
    5: [ // Goerli Testnet
      '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C', // USDC
      '0xC04B0d3107736C32e19F1c62b2aF67BE61d63a05', // WBTC
    ],
    11155111: [ // Sepolia Testnet
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // USDC
      '0x3e622317f8C93f7328350cF0B56d9eD4C620C5d6', // DAI
      '0x779877A7B0D9E8603169DdbD7836e478b4624789', // LINK
    ],
    // Add more networks as needed
  };

  // Updates token prices periodically (would connect to a real price oracle in production)
  async updateTokenPrices(chainId: number): Promise<void> {
    try {
      // In a real implementation, this would fetch from a price API like CoinGecko, 1inch, etc.
      // For demo purposes, we'll populate with sample data

      const mockPrices: Record<string, number> = {
        // Ethereum Mainnet
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 1.0,      // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7': 1.0,      // USDT
        '0x6B175474E89094C44Da98b954EedeAC495271d0F': 1.0,      // DAI
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 65000,    // WBTC
        '0x514910771AF9Ca656af840dff83E8264EcF986CA': 18.5,     // LINK

        // Goerli Testnet
        '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C': 1.0,      // USDC
        '0xC04B0d3107736C32e19F1c62b2aF67BE61d63a05': 65000,    // WBTC

        // Sepolia Testnet
        '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': 1.0,      // USDC
        '0x3e622317f8C93f7328350cF0B56d9eD4C620C5d6': 1.0,      // DAI
        '0x779877A7B0D9E8603169DdbD7836e478b4624789': 18.5,     // LINK
      };

      // Store the mock prices
      for (const [address, price] of Object.entries(mockPrices)) {
        try {
          // Use proper checksum format for the address
          const checksummedAddress = ethers.getAddress(address);
          // Store with lowercase key for consistent lookups
          this.tokenPrices.set(checksummedAddress.toLowerCase(), {
            address: checksummedAddress,
            priceUsd: price,
          });
        } catch (error) {
          this.logger.error(`Invalid address in price data: ${address}`);
        }
      }

      this.logger.log(`Updated prices for ${this.tokenPrices.size} tokens`);
    } catch (error) {
      this.logger.error(`Failed to update token prices: ${error.message}`);
    }
  }

  // Fetches token metadata (name, symbol, decimals)
  async getTokenMetadata(
    provider: ethers.JsonRpcProvider,
    tokenAddress: string,
  ): Promise<{ name: string; symbol: string; decimals: number }> {
    try {
      // Ensure proper checksum format for the address
      const checksummedAddress = ethers.getAddress(tokenAddress);

      // Normalize address for consistent lookups (lowercase for map keys)
      const normalizedAddress = checksummedAddress.toLowerCase();

      // Check if we already have metadata cached
      if (this.tokenMetadata.has(normalizedAddress)) {
        const metadata = this.tokenMetadata.get(normalizedAddress);
        this.logger.log(`Using cached metadata for token ${checksummedAddress}`);
        // Add non-null assertion since we already checked with .has()
        return metadata!;
      }

      this.logger.log(`Fetching metadata for token ${checksummedAddress}`);

      // Create contract instance with checksummed address
      const tokenContract = new ethers.Contract(checksummedAddress, ERC20_ABI, provider);

      // Fetch token metadata with individual try/catch blocks for better error isolation
      let name = 'Unknown Token';
      let symbol = 'UNKNOWN';
      let decimals = 18;

      try {
        name = await tokenContract.name();
        this.logger.log(`Got name for ${checksummedAddress}: ${name}`);
      } catch (nameError) {
        this.logger.error(`Failed to get name for token ${checksummedAddress}: ${nameError.message}`);
      }

      try {
        symbol = await tokenContract.symbol();
        this.logger.log(`Got symbol for ${checksummedAddress}: ${symbol}`);
      } catch (symbolError) {
        this.logger.error(`Failed to get symbol for token ${checksummedAddress}: ${symbolError.message}`);
      }

      try {
        decimals = await tokenContract.decimals();
        this.logger.log(`Got decimals for ${checksummedAddress}: ${decimals}`);
      } catch (decimalsError) {
        this.logger.error(`Failed to get decimals for token ${checksummedAddress}: ${decimalsError.message}`);
      }

      const metadata = { name, symbol, decimals };

      // Cache the metadata
      this.tokenMetadata.set(normalizedAddress, metadata);

      return metadata;
    } catch (error) {
      this.logger.error(`Failed to fetch metadata for token ${tokenAddress}: ${error.message}`, error.stack);
      // Return default values if metadata fetch fails
      return { name: 'Unknown Token', symbol: 'UNKNOWN', decimals: 18 };
    }
  }

  // Gets token price from the cache
  getTokenPrice(tokenAddress: string): number | null {
    try {
      // Ensure proper checksum format for the address
      const checksummedAddress = ethers.getAddress(tokenAddress);
      // Use lowercase for lookup
      const normalizedAddress = checksummedAddress.toLowerCase();
      const tokenInfo = this.tokenPrices.get(normalizedAddress);
      return tokenInfo ? tokenInfo.priceUsd : null;
    } catch (error) {
      this.logger.error(`Error getting token price for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Fetches token balances for a specific address
  async getTokenBalances(
    provider: ethers.JsonRpcProvider,
    walletAddress: string,
    chainId: number,
  ): Promise<TokenInfo[]> {
    const results: TokenInfo[] = [];

    try {
      // Make sure we have the latest prices
      await this.updateTokenPrices(chainId);

      // Get list of token addresses to check
      // In a production app, this would be determined by a more sophisticated indexing service
      // that scans past transactions or uses an external API
      const rawTokenAddresses = this.popularTokens[chainId] || [];

      // Convert all addresses to proper checksum format
      const tokenAddresses: string[] = [];
      for (const address of rawTokenAddresses) {
        try {
          tokenAddresses.push(ethers.getAddress(address));
        } catch (error) {
          this.logger.error(`Invalid token address in configuration: ${address}`);
        }
      }

      this.logger.log(`Checking ${tokenAddresses.length} tokens for address ${walletAddress} on chain ${chainId}`);

      // If no tokens defined for this chain ID, return empty array
      if (tokenAddresses.length === 0) {
        this.logger.warn(`No tokens configured for chain ID ${chainId}`);
        return [];
      }

      // Set timeout for contract calls
      const timeout = 10000; // 10 seconds

      for (const tokenAddress of tokenAddresses) {
        try {
          this.logger.log(`Checking token ${tokenAddress} for address ${walletAddress}`);

          // Create contract instance with checksummed address
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

          this.logger.log(`Contract created for ${tokenAddress}, attempting to call balanceOf`);

          // Ensure wallet address is also checksummed
          const checksummedWalletAddress = ethers.getAddress(walletAddress);

          // Get balance with timeout
          let balance: bigint;
          try {
            const balancePromise = tokenContract.balanceOf(checksummedWalletAddress);

            // Create a timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`Timeout calling balanceOf on ${tokenAddress}`)), timeout);
            });

            // Race between the balance call and timeout
            balance = await Promise.race([balancePromise, timeoutPromise]);

            this.logger.log(`Retrieved balance for ${tokenAddress}: ${balance.toString()}`);
          } catch (balanceError) {
            this.logger.error(`Error getting balance from ${tokenAddress}: ${balanceError.message}`);
            // Skip this token and continue with the next
            continue;
          }

          // Get token metadata
          const { name, symbol, decimals } = await this.getTokenMetadata(provider, tokenAddress);

          this.logger.log(`Got metadata for ${tokenAddress}: name=${name}, symbol=${symbol}, decimals=${decimals}`);

          // Format balance with proper decimals
          const balanceFormatted = ethers.formatUnits(balance, decimals);

          // Get price if available
          const priceUsd = this.getTokenPrice(tokenAddress);

          // Calculate USD value
          const valueUsd = priceUsd !== null
            ? parseFloat(balanceFormatted) * priceUsd
            : null;

          // Only include tokens with non-zero balance
          if (balance > 0n) {
            results.push({
              address: tokenAddress,
              name,
              symbol,
              decimals,
              balance: balance.toString(),
              balanceFormatted,
              priceUsd,
              valueUsd,
            });

            this.logger.log(`Added token ${symbol} with balance ${balanceFormatted} to results`);
          } else {
            this.logger.log(`Skipping token ${symbol} with zero balance`);
          }
        } catch (error) {
          this.logger.error(`Error fetching balance for token ${tokenAddress}: ${error.message}`, error.stack);
          // Continue to the next token instead of failing the entire request
        }
      }

      // Ensure all BigInt values are stringified before sending in the response
      return results.map(token => ({
        ...token,
        balance: typeof token.balance === 'string' ? token.balance : String(token.balance)
      }));
    } catch (error) {
      this.logger.error(`Error in getTokenBalances: ${error.message}`);

      // Return mock data as fallback if everything else fails
      this.logger.warn('Returning fallback mock token data after error');
      return [
        {
          address: '0x0000000000000000000000000000000000000000',
          name: 'Fallback Token',
          symbol: 'FALLBACK',
          decimals: 18,
          balance: '1000000000000000000',
          balanceFormatted: '1.0',
          priceUsd: 1.0,
          valueUsd: 1.0,
        }
      ];
    }
  }

  // In a real application, you would add methods to:
  // 1. Index token transfers for an address (using event logs)
  // 2. Discover new tokens owned by an address (from transfer events)
  // 3. Connect to external APIs for more comprehensive token lists
}