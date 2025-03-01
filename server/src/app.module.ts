import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SafeModule } from './safe/safe.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env', // Explicitly specify .env file
      isGlobal: true, // Make env vars globally available
    }),
    SafeModule,
  ],
})
export class AppModule {}
