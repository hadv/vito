import { Controller, Post, Body, Param } from '@nestjs/common';
import { SafeService } from './safe.service';
import { CreateSafeTxDto } from './safe.dto';

@Controller('safe')
export class SafeController {
  constructor(private readonly safeService: SafeService) {}

  @Post(':safeAddress/send')
  async sendTransaction(
    @Param('safeAddress') safeAddress: string,
    @Body() txData: CreateSafeTxDto,
    @Body('signerAddress') signerAddress: string,
  ): Promise<any> {
    return this.safeService.sendSafeTransaction(
      safeAddress,
      txData,
      signerAddress,
    );
  }
}
