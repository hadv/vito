import { Module } from '@nestjs/common';
import { SafeController } from './safe.controller';
import { SafeService } from './safe.service';
import { SafeGateway } from './safe.gateway';

@Module({
  controllers: [SafeController],
  providers: [SafeService, SafeGateway],
})
export class SafeModule {}
