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
      
      // Return cached data if valid and contains enough transactions
      if (cachedData && 
          Date.now() - cachedData.timestamp < this.CACHE_TIMEOUT && 
          cachedData.transactions.length > skip) { // Must have enough transactions to cover the skip
        this.logger.log(`Using cached blockchain transactions for ${safeAddress}`);
        
        // Check if we have enough cached transactions to satisfy the request
        if (cachedData.transactions.length >= skip + first) {
          // We have enough data in cache for this page
          return cachedData.transactions.slice(skip, skip + first);
        } else {
          // We need to fetch more data and append to cache
          this.logger.log(`Cached data insufficient, fetching more from Etherscan for ${safeAddress}`);
        }
      }
      
      // Fetch transactions using Etherscan API
      const transactions = await this.getBlockchainTransactionsFromEtherscan(safeAddress, chainId, first, skip);
      
      // Log if no transactions were found
      if (transactions.length === 0) {
        this.logger.log(`No blockchain transactions found via Etherscan for ${safeAddress}`);
        return [];
      }
      
      // Update or initialize cache
      if (cachedData && skip > 0) {
        // Append to existing cache for pagination
        const updatedTransactions = [...cachedData.transactions];
        
        // Avoid duplicates when appending
        for (const tx of transactions) {
          if (!updatedTransactions.some(existingTx => existingTx.id === tx.id)) {
            updatedTransactions.push(tx);
          }
        }
        
        // Sort again to ensure proper order
        updatedTransactions.sort((a, b) => b.timestamp - a.timestamp);
        
        this.txCache[cacheKey] = {
          transactions: updatedTransactions,
          timestamp: Date.now()
        };
        this.logger.log(`Updated cache with ${transactions.length} more transactions for ${safeAddress}, total: ${updatedTransactions.length}`);
      } else {
        // Create new cache entry
        this.txCache[cacheKey] = {
          transactions,
          timestamp: Date.now()
        };
        this.logger.log(`Cached ${transactions.length} blockchain transactions for ${safeAddress}`);
      }
      
      return transactions;
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
      
      // First, fetch normal transactions (external)
      const normalTxUrl = `${apiUrl}?module=account&action=txlist&address=${safeAddressLowercase}&startblock=0&endblock=99999999&page=${Math.floor(offset/limit) + 1}&offset=${limit}&sort=desc&apikey=${apiKey}`;
      
      const normalTxResponse = await fetch(normalTxUrl);
      const normalTxData = await normalTxResponse.json();
      
      this.logger.log(`Received normal transaction data from Etherscan: ${JSON.stringify(normalTxData)}`);
      
      // Process normal transactions if successful
      if (normalTxData.status === '1' && Array.isArray(normalTxData.result)) {
        for (const tx of normalTxData.result) {
          const isOutgoing = tx.from.toLowerCase() === safeAddressLowercase;
          
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
            }
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
              method: isOutgoing ? 'Outgoing Internal Transaction' : 'Incoming Internal Transaction',
            }
          });
        }
      }
      
      // Finally, fetch ERC20 token transfers
      const tokenTxUrl = `${apiUrl}?module=account&action=tokentx&address=${safeAddressLowercase}&startblock=0&endblock=99999999&page=${Math.floor(offset/limit) + 1}&offset=${limit}&sort=desc&apikey=${apiKey}`;
      
      const tokenTxResponse = await fetch(tokenTxUrl);
      const tokenTxData = await tokenTxResponse.json();
      
      this.logger.log(`Received token transaction data from Etherscan: ${JSON.stringify(tokenTxData)}`);
      
      // Process token transactions if successful
      if (tokenTxData.status === '1' && Array.isArray(tokenTxData.result)) {
        for (const tx of tokenTxData.result) {
          const isOutgoing = tx.from.toLowerCase() === safeAddressLowercase;
          
          transactions.push({
            id: `${tx.hash}-token-${tx.tokenSymbol}`,
            timestamp: parseInt(tx.timeStamp, 10),
            txHash: tx.hash,
            executedTxHash: tx.hash,
            value: tx.value,
            nonce: 0, // Token transfers don't have their own nonce
            to: tx.to,
            from: tx.from,
            data: '0x', // Simplified data representation
            operation: 0,
            safeTxHash: tx.hash,
            isExecuted: true,
            dataDecoded: {
              method: isOutgoing ? `Outgoing ${tx.tokenSymbol} Transfer` : `Incoming ${tx.tokenSymbol} Transfer`,
              parameters: [
                {
                  name: 'tokenAddress',
                  type: 'address',
                  value: tx.contractAddress
                },
                {
                  name: 'tokenSymbol',
                  type: 'string',
                  value: tx.tokenSymbol
                },
                {
                  name: 'tokenDecimals',
                  type: 'uint256',
                  value: tx.tokenDecimal
                }
              ]
            }
          });
        }
      }
      
      // Sort all transactions by timestamp (newest first)
      transactions.sort((a, b) => b.timestamp - a.timestamp);
      
      // Remove duplicates by transaction hash (keeping the first occurrence)
      const uniqueTxMap = new Map<string, SafeTransaction>();
      for (const tx of transactions) {
        if (!uniqueTxMap.has(tx.id)) {
          uniqueTxMap.set(tx.id, tx);
        }
      }
      
      // Return paginated results
      const results = Array.from(uniqueTxMap.values()).slice(0, limit);
      this.logger.log(`Returning ${results.length} blockchain transactions for ${safeAddressLowercase}`);
      return results;
    } catch (error) {
      this.logger.error(`Error querying Etherscan API for blockchain transactions: ${error.message}`, error.stack);
      return [];
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