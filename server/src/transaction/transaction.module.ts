import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { AIModule } from './services/ai/ai.module';

@Module({
  imports: [ConfigModule, AIModule],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {} 