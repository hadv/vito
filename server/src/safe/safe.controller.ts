import { Controller, Post, Body } from '@nestjs/common';
import { SafeService } from './safe.service';

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
  ) {
    return this.safeService.sendSafeTransaction(
      safeAddress,
      to,
      value,
      data,
      operation,
    );
  }
}
