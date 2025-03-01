import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { SafeModule } from './safe/safe.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env', // Explicitly specify .env file
      isGlobal: true, // Make env vars globally available
    }),
    HttpModule,
    SafeModule,
  ],
})
export class AppModule {}
