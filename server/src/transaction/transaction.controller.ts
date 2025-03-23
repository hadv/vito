import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe, Logger } from '@nestjs/common';
import { TransactionService, SafeTransaction } from './transaction.service';

@Controller('transactions')
export class TransactionController {
  private readonly logger = new Logger(TransactionController.name);

  constructor(private readonly transactionService: TransactionService) {}

  /**
   * Get transactions for a Safe wallet from Etherscan
   * (Maintained for backward compatibility, uses the same data source as /blockchain endpoint)
   * @param safeAddress Safe wallet address
   * @param chainId Chain ID (default: 1 for Ethereum mainnet)
   * @param limit Number of transactions to fetch (default: 100)
   * @param offset Number of transactions to skip for pagination (default: 0)
   * @returns List of Safe transactions
   */
  @Get('safe')
  async getSafeTransactions(
    @Query('safeAddress') safeAddress: string,
    @Query('chainId', new DefaultValuePipe(1), ParseIntPipe) chainId: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<{ transactions: SafeTransaction[] }> {
    this.logger.log(`Fetching transactions for Safe ${safeAddress} on chain ${chainId}`);
    
    const transactions = await this.transactionService.getSafeTransactions(
      safeAddress,
      chainId,
      limit,
      offset,
    );
    
    return { transactions };
  }

  /**
   * Get blockchain transactions related to a Safe wallet address via Etherscan
   * @param safeAddress Safe wallet address
   * @param chainId Chain ID (default: 1 for Ethereum mainnet)
   * @param limit Number of transactions to fetch (default: 100)
   * @param offset Number of transactions to skip for pagination (default: 0)
   * @returns List of blockchain transactions
   */
  @Get('blockchain')
  async getBlockchainTransactions(
    @Query('safeAddress') safeAddress: string,
    @Query('chainId', new DefaultValuePipe(1), ParseIntPipe) chainId: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<{ transactions: SafeTransaction[] }> {
    this.logger.log(`Fetching blockchain transactions for Safe ${safeAddress} on chain ${chainId}`);
    
    const transactions = await this.transactionService.getBlockchainTransactions(
      safeAddress,
      chainId,
      limit,
      offset,
    );
    
    return { transactions };
  }
} 