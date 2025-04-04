import { Controller, Post, Body, Get, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { SafeService } from './safe.service';
import { SafeTransaction } from './types';

@Controller('safe')
export class SafeController {
  constructor(private readonly safeService: SafeService) {}

  @Post('send-transaction')
  async sendSafeTransaction(
    @Body('safeAddress') safeAddress: string,
    @Body('to') to: string,
    @Body('value') value: string,
    @Body('data') data: string,
    @Body('operation') operation: number,
    @Body('network') network: string,
  ) {
    return this.safeService.sendSafeTransaction(
      safeAddress,
      to,
      value,
      data,
      operation,
      network,
    );
  }

  @Get('info/:address')
  async getSafeInfo(@Param('address') address: string, @Query('network') network: string) {
    try {
      const safeInfo = await this.safeService.getSafeInfo(address, network);
      return safeInfo;
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch Safe info',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('prepare-transaction')
  async prepareTransaction(
    @Body() data: { safeAddress: string; transaction: SafeTransaction; network: string },
  ) {
    try {
      console.log('Received prepare transaction request:', JSON.stringify(data, null, 2));

      // Validate input data
      if (!data.safeAddress) {
        throw new Error('safeAddress is required');
      }
      if (!data.transaction) {
        throw new Error('transaction object is required');
      }
      if (!data.transaction.to) {
        throw new Error('transaction.to is required');
      }
      if (!data.network) {
        throw new Error('network is required');
      }

      const { safeAddress, transaction, network } = data;
      console.log('Calling safeService.prepareTransaction with:', {
        safeAddress,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
        operation: transaction.operation,
        network
      });

      const preparedTx = await this.safeService.prepareTransaction(
        safeAddress,
        transaction.to,
        transaction.value,
        transaction.data,
        transaction.operation || 0,
        network,
      );

      console.log('Transaction prepared successfully:', JSON.stringify(preparedTx, null, 2));
      return preparedTx;
    } catch (error) {
      console.error('Error in prepareTransaction controller:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          cause: error.cause
        });
      }
      throw new HttpException(
        error.message || 'Failed to prepare transaction',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('pending-transactions')
  async getPendingTransactions(
    @Body('safeAddress') safeAddress: string,
    @Body('network') network: string,
  ) {
    try {
      if (!safeAddress) {
        throw new Error('safeAddress is required');
      }
      if (!network) {
        throw new Error('network is required');
      }

      const transactions = await this.safeService.getPendingTransactions(safeAddress, network);
      return { transactions };
    } catch (error) {
      console.error('Error in getPendingTransactions controller:', error);
      throw new HttpException(
        error.message || 'Failed to fetch pending transactions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('add-signature')
  async addSignature(
    @Body('safeAddress') safeAddress: string,
    @Body('safeTxHash') safeTxHash: string,
    @Body('signature') signature: string,
    @Body('network') network: string,
  ) {
    try {
      if (!safeAddress) {
        throw new Error('safeAddress is required');
      }
      if (!safeTxHash) {
        throw new Error('safeTxHash is required');
      }
      if (!signature) {
        throw new Error('signature is required');
      }
      if (!network) {
        throw new Error('network is required');
      }

      const result = await this.safeService.addSignature(safeAddress, safeTxHash, signature, network);
      return result;
    } catch (error) {
      console.error('Error in addSignature controller:', error);
      throw new HttpException(
        error.message || 'Failed to add signature',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('execute-transaction')
  async executeTransaction(
    @Body('safeAddress') safeAddress: string,
    @Body('safeTxHash') safeTxHash: string,
    @Body('network') network: string,
  ) {
    try {
      if (!safeAddress) {
        throw new Error('safeAddress is required');
      }
      if (!safeTxHash) {
        throw new Error('safeTxHash is required');
      }
      if (!network) {
        throw new Error('network is required');
      }

      const result = await this.safeService.executeTransaction(safeAddress, safeTxHash, network);
      return result;
    } catch (error) {
      console.error('Error in executeTransaction controller:', error);
      throw new HttpException(
        error.message || 'Failed to execute transaction',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
