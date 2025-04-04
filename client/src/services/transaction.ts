import { BlockchainTransaction } from '@/types';

/**
 * Service for fetching blockchain transactions related to a Safe wallet address from Etherscan
 */
export class TransactionService {
  private readonly apiUrl: string;

  constructor() {
    this.apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  }

  /**
   * Fetch blockchain transactions related to a Safe wallet address
   * @param safeAddress The Safe wallet address
   * @param chainId Chain ID (default: 1 for Ethereum mainnet)
   * @param limit Number of transactions to fetch
   * @param offset Offset for pagination
   * @returns Array of transactions
   */
  async getSafeTransactions(
    safeAddress: string,
    chainId: number = 1,
    limit: number = 100,
    offset: number = 0
  ): Promise<BlockchainTransaction[]> {
    try {
      const queryParams = new URLSearchParams({
        safeAddress,
        chainId: chainId.toString(),
        limit: limit.toString(),
        offset: offset.toString(),
        blockchainOnly: 'true' // New parameter to specify we want blockchain transactions only
      });

      const url = `${this.apiUrl}/transactions/blockchain?${queryParams}`;
      console.log(`Fetching blockchain transactions for Safe ${safeAddress} from: ${url}`);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Received ${data.transactions?.length || 0} blockchain transactions from API`);
      return data.transactions;
    } catch (error) {
      console.error('Error fetching blockchain transactions:', error);
      throw error;
    }
  }
}