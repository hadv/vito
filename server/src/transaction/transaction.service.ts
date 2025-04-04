import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fetch from 'node-fetch';

export interface SafeTransaction {
  id: string;
  timestamp: number;
  txHash: string;
  executedTxHash?: string;
  value: string;
  nonce: number;
  to: string;
  from?: string;
  data: string;
  operation: number;
  safeTxHash: string;
  executor?: string;
  executionDate?: string;
  confirmations?: {
    owner: string;
    signature: string;
    submissionDate: string;
  }[];
  isExecuted: boolean;
  dataDecoded?: {
    method: string;
    parameters?: Array<{
      name: string;
      type: string;
      value: any;
    }>;
  };
  tokenInfo?: {
    address: string;
    symbol: string;
    decimals: number;
    name: string;
  };
  stateChanges: {
    tokenAddress: string;
    tokenSymbol: string;
    tokenDecimals: number;
    from: string;
    to: string;
    value: string;
    isStateChange: boolean;
  }[];
}

interface TransactionCache {
  transactions: SafeTransaction[];
  timestamp: number;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  // Etherscan API keys by chain ID
  private etherscanApiKeys: Record<number, string> = {};

  // Etherscan API URLs by chain ID
  private etherscanApis: Record<number, string> = {};

  // In-memory cache for transactions to reduce API calls
  private txCache: Record<string, TransactionCache> = {};

  // Cache timeout in milliseconds (5 minutes)
  private readonly CACHE_TIMEOUT = 5 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
  ) {
    // Get a single API key for all networks
    const apiKey = this.configService.get<string>('ETHERSCAN_API_KEY', 'PXN99XX2X2RY6GDK6IIC8MK9D7NI1Y7TI2');

    // Use the same API key for all networks
    this.etherscanApiKeys = {
      1: apiKey,
      5: apiKey,
      11155111: apiKey,
      137: apiKey,
      80001: apiKey,
      10: apiKey,
      8453: apiKey,
      100: apiKey,
    };

    // Initialize Etherscan API URLs from environment variables
    this.etherscanApis = {
      1: this.configService.get<string>('ETHERSCAN_API_URL_MAINNET', 'https://api.etherscan.io/api'),
      5: this.configService.get<string>('ETHERSCAN_API_URL_GOERLI', 'https://api-goerli.etherscan.io/api'),
      11155111: this.configService.get<string>('ETHERSCAN_API_URL_SEPOLIA', 'https://api-sepolia.etherscan.io/api'),
      137: this.configService.get<string>('ETHERSCAN_API_URL_POLYGON', 'https://api.polygonscan.com/api'),
      80001: this.configService.get<string>('ETHERSCAN_API_URL_MUMBAI', 'https://api-testnet.polygonscan.com/api'),
      10: this.configService.get<string>('ETHERSCAN_API_URL_OPTIMISM', 'https://api-optimistic.etherscan.io/api'),
      8453: this.configService.get<string>('ETHERSCAN_API_URL_BASE', 'https://api.basescan.org/api'),
      100: this.configService.get<string>('ETHERSCAN_API_URL_GNOSIS', 'https://api.gnosisscan.io/api'),
    };

    this.logger.log('Initialized Etherscan API configurations');
  }

  /**
   * Get blockchain transactions related to a Safe wallet address via Etherscan
   * @param safeAddress Safe wallet address
   * @param chainId Chain ID for the safe
   * @param first Number of transactions to fetch (default: 100)
   * @param skip Number of transactions to skip (default: 0, for pagination)
   * @returns Array of transformed transactions
   */
  async getBlockchainTransactions(
    safeAddress: string,
    chainId: number,
    first = 100,
    skip = 0,
  ): Promise<SafeTransaction[]> {
    try {
      // Check cache first
      const cacheKey = `${safeAddress.toLowerCase()}-${chainId}-blockchain`;
      const cachedData = this.txCache[cacheKey];

      // If we have cached data and enough transactions, use it
      if (cachedData &&
          Date.now() - cachedData.timestamp < this.CACHE_TIMEOUT &&
          cachedData.transactions.length > skip) { // Must have enough transactions to cover the skip
        this.logger.log(`Using cached blockchain transactions for ${safeAddress}`);

        // Check if we have enough cached transactions to satisfy the request
        if (cachedData.transactions.length >= skip + first) {
          // We have enough data in cache for this page
          return cachedData.transactions.slice(skip, skip + first);
        }
      }

      // Either no cache or not enough cached data - fetch from Etherscan
      const fetchLimit = Math.max(first * 3, 100); // Fetch more than needed to account for deduplication
      const transactions = await this.getBlockchainTransactionsFromEtherscan(
        safeAddress,
        chainId,
        fetchLimit,
        0 // Always fetch from beginning to properly deduplicate
      );

      // Log if no transactions were found
      if (transactions.length === 0) {
        this.logger.log(`No blockchain transactions found via Etherscan for ${safeAddress}`);
        return [];
      }

      // Store in cache
      this.txCache[cacheKey] = {
        transactions,
        timestamp: Date.now()
      };
      this.logger.log(`Cached ${transactions.length} blockchain transactions for ${safeAddress}`);

      // Return the requested page
      const availableCount = transactions.length;
      if (skip >= availableCount) {
        return []; // No more transactions
      }

      return transactions.slice(skip, Math.min(skip + first, availableCount));
    } catch (error) {
      this.logger.error(`Error fetching blockchain transactions: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Fetch blockchain transactions via Etherscan API
   */
  private async getBlockchainTransactionsFromEtherscan(
    safeAddress: string,
    chainId: number,
    limit = 100,
    offset = 0,
  ): Promise<SafeTransaction[]> {
    const apiKey = this.etherscanApiKeys[chainId];
    const apiUrl = this.etherscanApis[chainId];

    if (!apiKey || !apiUrl) {
      this.logger.error(`No Etherscan API configuration found for chain ID ${chainId}`);
      return [];
    }

    const safeAddressLowercase = safeAddress.toLowerCase();
    this.logger.log(`Fetching blockchain transactions for ${safeAddressLowercase} on chain ${chainId} from Etherscan`);

    try {
      // We'll fetch both incoming and outgoing transactions
      const transactions: SafeTransaction[] = [];
      // Track transaction hashes to avoid duplicates
      const processedTxHashes = new Set<string>();

      // First, fetch normal transactions (external)
      const normalTxUrl = `${apiUrl}?module=account&action=txlist&address=${safeAddressLowercase}&startblock=0&endblock=99999999&page=${Math.floor(offset/limit) + 1}&offset=${limit}&sort=desc&apikey=${apiKey}`;

      const normalTxResponse = await fetch(normalTxUrl);
      const normalTxData = await normalTxResponse.json();

      this.logger.log(`Received normal transaction data from Etherscan: ${JSON.stringify(normalTxData)}`);

      // Process normal transactions if successful
      if (normalTxData.status === '1' && Array.isArray(normalTxData.result)) {
        for (const tx of normalTxData.result) {
          const isOutgoing = tx.from.toLowerCase() === safeAddressLowercase;

          // Add to the set of processed tx hashes
          processedTxHashes.add(tx.hash.toLowerCase());

          transactions.push({
            id: tx.hash,
            timestamp: parseInt(tx.timeStamp, 10),
            txHash: tx.hash,
            executedTxHash: tx.hash,
            value: tx.value,
            nonce: parseInt(tx.nonce, 10),
            to: tx.to,
            from: tx.from,
            data: tx.input,
            operation: 0, // Standard operation
            safeTxHash: tx.hash,
            isExecuted: true,
            dataDecoded: {
              method: isOutgoing ? 'Outgoing Transaction' : 'Incoming Transaction',
            },
            tokenInfo: undefined,
            stateChanges: [{
              tokenAddress: '0x0000000000000000000000000000000000000000', // Native token
              tokenSymbol: this.getNativeTokenSymbol(chainId),
              tokenDecimals: 18,
              from: tx.from,
              to: tx.to,
              value: tx.value,
              isStateChange: true
            }]
          });
        }
      }

      // Next, fetch internal transactions
      const internalTxUrl = `${apiUrl}?module=account&action=txlistinternal&address=${safeAddressLowercase}&startblock=0&endblock=99999999&page=${Math.floor(offset/limit) + 1}&offset=${limit}&sort=desc&apikey=${apiKey}`;

      const internalTxResponse = await fetch(internalTxUrl);
      const internalTxData = await internalTxResponse.json();

      this.logger.log(`Received internal transaction data from Etherscan: ${JSON.stringify(internalTxData)}`);

      // Process internal transactions if successful
      if (internalTxData.status === '1' && Array.isArray(internalTxData.result)) {
        for (const tx of internalTxData.result) {
          const isOutgoing = tx.from.toLowerCase() === safeAddressLowercase;
          const isIncoming = tx.to.toLowerCase() === safeAddressLowercase;

          // Only process state changes for the safe address
          if (!isOutgoing && !isIncoming) continue;

          // Check if this tx hash has already been processed
          const txHashLower = tx.hash.toLowerCase();

          // Check if this internal tx is part of an existing transaction
          const existingTxIndex = transactions.findIndex(t => t.txHash.toLowerCase() === txHashLower);

          if (existingTxIndex >= 0) {
            // Add this as a state change to the existing transaction
            transactions[existingTxIndex].stateChanges.push({
              tokenAddress: '0x0000000000000000000000000000000000000000', // Native token
              tokenSymbol: this.getNativeTokenSymbol(chainId),
              tokenDecimals: 18,
              from: tx.from,
              to: tx.to,
              value: tx.value,
              isStateChange: true
            });
          } else if (!processedTxHashes.has(txHashLower)) {
            // Add as a new transaction only if we haven't seen this hash before
            processedTxHashes.add(txHashLower);

            transactions.push({
              id: `${tx.hash}-${tx.traceId || '0'}`,
              timestamp: parseInt(tx.timeStamp, 10),
              txHash: tx.hash,
              executedTxHash: tx.hash,
              value: tx.value,
              nonce: 0, // Internal transactions don't have their own nonce
              to: tx.to,
              from: tx.from,
              data: '0x', // Internal transactions typically don't have input data
              operation: 0,
              safeTxHash: tx.hash,
              isExecuted: true,
              dataDecoded: {
                method: isOutgoing ? 'Outgoing Transaction' : 'Incoming Transaction',
              },
              tokenInfo: undefined,
              stateChanges: [{
                tokenAddress: '0x0000000000000000000000000000000000000000', // Native token
                tokenSymbol: this.getNativeTokenSymbol(chainId),
                tokenDecimals: 18,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                isStateChange: true
              }]
            });
          }
        }
      }

      // Also fetch ERC20 token transfers
      const tokenTxUrl = `${apiUrl}?module=account&action=tokentx&address=${safeAddressLowercase}&startblock=0&endblock=99999999&page=${Math.floor(offset/limit) + 1}&offset=${limit}&sort=desc&apikey=${apiKey}`;

      const tokenTxResponse = await fetch(tokenTxUrl);
      const tokenTxData = await tokenTxResponse.json();

      this.logger.log(`Received token transaction data from Etherscan: ${JSON.stringify(tokenTxData)}`);

      // Process token transfers if successful
      if (tokenTxData.status === '1' && Array.isArray(tokenTxData.result)) {
        for (const tx of tokenTxData.result) {
          const isOutgoing = tx.from.toLowerCase() === safeAddressLowercase;
          const isIncoming = tx.to.toLowerCase() === safeAddressLowercase;

          // Only process state changes for the safe address
          if (!isOutgoing && !isIncoming) continue;

          // Check if this tx hash has already been processed in regular transactions
          const txHashLower = tx.hash.toLowerCase();

          // Check if this token tx is part of an existing transaction
          const existingTxIndex = transactions.findIndex(t => t.txHash.toLowerCase() === txHashLower);

          if (existingTxIndex >= 0) {
            // Add this as a state change to the existing transaction
            transactions[existingTxIndex].stateChanges.push({
              tokenAddress: tx.contractAddress,
              tokenSymbol: tx.tokenSymbol || await this.getTokenSymbol(tx.contractAddress, chainId),
              tokenDecimals: parseInt(tx.tokenDecimal, 10) || 18,
              from: tx.from,
              to: tx.to,
              value: tx.value,
              isStateChange: true
            });
          } else if (!processedTxHashes.has(txHashLower)) {
            // Add as a new transaction only if we haven't seen this hash before
            processedTxHashes.add(txHashLower);

            transactions.push({
              id: `${tx.hash}-token-${tx.contractAddress}`,
              timestamp: parseInt(tx.timeStamp, 10),
              txHash: tx.hash,
              executedTxHash: tx.hash,
              value: '0', // Native token value is 0 for token transfers
              nonce: 0,
              to: tx.to,
              from: tx.from,
              data: '0x',
              operation: 0,
              safeTxHash: tx.hash,
              isExecuted: true,
              dataDecoded: {
                method: isOutgoing ? 'Token Outgoing' : 'Token Incoming',
                parameters: [{
                  name: 'tokenAddress',
                  type: 'address',
                  value: tx.contractAddress
                }, {
                  name: 'tokenSymbol',
                  type: 'string',
                  value: tx.tokenSymbol || await this.getTokenSymbol(tx.contractAddress, chainId)
                }, {
                  name: 'tokenValue',
                  type: 'uint256',
                  value: tx.value
                }]
              },
              tokenInfo: {
                address: tx.contractAddress,
                symbol: tx.tokenSymbol || await this.getTokenSymbol(tx.contractAddress, chainId),
                decimals: parseInt(tx.tokenDecimal, 10) || 18,
                name: tx.tokenName || 'Unknown Token'
              },
              stateChanges: [{
                tokenAddress: tx.contractAddress,
                tokenSymbol: tx.tokenSymbol || await this.getTokenSymbol(tx.contractAddress, chainId),
                tokenDecimals: parseInt(tx.tokenDecimal, 10) || 18,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                isStateChange: true
              }]
            });
          }
        }
      }

      // Final deduplication by txHash to ensure no duplicates
      const uniqueTransactions: SafeTransaction[] = [];
      const txMap = new Map<string, SafeTransaction>();

      for (const tx of transactions) {
        const txHashLower = tx.txHash.toLowerCase();
        if (!txMap.has(txHashLower)) {
          txMap.set(txHashLower, tx);
          uniqueTransactions.push(tx);
        }
      }

      // Sort by timestamp (newest first)
      uniqueTransactions.sort((a, b) => b.timestamp - a.timestamp);

      // Apply pagination
      const paginatedTransactions = uniqueTransactions.slice(
        offset - Math.floor(offset/limit) * limit,
        offset - Math.floor(offset/limit) * limit + limit
      );

      this.logger.log(`Returning ${paginatedTransactions.length} blockchain transactions for ${safeAddressLowercase}`);
      return paginatedTransactions;
    } catch (error) {
      this.logger.error(`Error fetching transactions from Etherscan: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Get the native token symbol for a given chain ID
   */
  private getNativeTokenSymbol(chainId: number): string {
    const symbolMap = {
      1: 'ETH',      // Ethereum
      5: 'GoerliETH', // Goerli
      11155111: 'SepETH', // Sepolia
      137: 'MATIC',  // Polygon
      80001: 'MATIC', // Mumbai
      10: 'ETH',     // Optimism
      8453: 'ETH',   // Base
      100: 'xDAI',   // Gnosis
    };
    return symbolMap[chainId] || 'ETH';
  }

  /**
   * Call the token contract to get the token symbol
   */
  private async getTokenSymbol(tokenAddress: string, chainId: number): Promise<string> {
    try {
      // RPC URLs by chain ID
      const rpcUrls = {
        1: 'https://eth.llamarpc.com',
        5: 'https://ethereum-goerli.publicnode.com',
        11155111: 'https://ethereum-sepolia.publicnode.com',
        137: 'https://polygon.llamarpc.com',
        80001: 'https://polygon-testnet.public.blastapi.io',
        10: 'https://optimism.publicnode.com',
        8453: 'https://base.llamarpc.com',
        100: 'https://gnosis.publicnode.com',
      };

      const rpcUrl = rpcUrls[chainId];
      if (!rpcUrl) {
        return 'UNKNOWN';
      }

      // ERC20 symbol() function signature
      const symbolData = '0x95d89b41'; // bytes4(keccak256('symbol()'))

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [
            {
              to: tokenAddress,
              data: symbolData
            },
            'latest'
          ]
        })
      });

      const result = await response.json();

      if (result.error) {
        this.logger.error(`Error calling token symbol: ${result.error.message}`);
        return 'UNKNOWN';
      }

      if (result.result && result.result.length >= 66) {
        // Parse ABI-encoded string response
        try {
          // Remove 0x prefix + 32 bytes for string location in memory
          const offset = parseInt(result.result.slice(2, 66), 16);
          // Length of the string is in the next 32 bytes
          const length = parseInt(result.result.slice(66, 130), 16);
          // The actual string data starts after that
          const hexString = result.result.slice(130, 130 + length * 2);
          // Convert hex to string
          return Buffer.from(hexString, 'hex').toString();
        } catch (e) {
          this.logger.error(`Error parsing token symbol: ${e.message}`);
          return 'UNKNOWN';
        }
      }

      return 'UNKNOWN';
    } catch (error) {
      this.logger.error(`Error getting token symbol: ${error.message}`);
      return 'UNKNOWN';
    }
  }

  /**
   * Get Safe transactions history - now simply returns blockchain transactions
   * for backward compatibility with existing code
   * @param safeAddress Safe wallet address
   * @param chainId Chain ID for the safe
   * @param first Number of transactions to fetch (default: 100)
   * @param skip Number of transactions to skip (default: 0, for pagination)
   * @returns Array of transactions
   */
  async getSafeTransactions(
    safeAddress: string,
    chainId: number,
    first = 100,
    skip = 0,
  ): Promise<SafeTransaction[]> {
    this.logger.log(`getSafeTransactions called for ${safeAddress} - redirecting to blockchain transactions`);
    return this.getBlockchainTransactions(safeAddress, chainId, first, skip);
  }
}