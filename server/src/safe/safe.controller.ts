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
      const { safeAddress, transaction, network } = data;
      const preparedTx = await this.safeService.prepareTransaction(
        safeAddress,
        transaction.to,
        transaction.value,
        transaction.data,
        transaction.operation || 0,
        network,
      );
      return preparedTx;
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to prepare transaction',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
