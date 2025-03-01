import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SafeController } from './safe.controller';
import { SafeService } from './safe.service';
import { SafeGateway } from './safe.gateway';

@Module({
  imports: [HttpModule],
  controllers: [SafeController],
  providers: [SafeService, SafeGateway],
})
export class SafeModule {}
