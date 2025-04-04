import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { TokenController } from './token.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [TokenService],
  controllers: [TokenController],
  exports: [TokenService],
})
export class TokenModule {}