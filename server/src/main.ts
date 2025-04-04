import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const app = await NestFactory.create(AppModule);

    // Enable CORS for development
    app.enableCors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
    });

    // Add global exception logging
    app.useLogger(logger);

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT') || 3000;
    await app.listen(port);
    logger.log(`Server running on port ${port}`);
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`, error.stack);
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('Error during bootstrap:', error);
  process.exit(1);
});
