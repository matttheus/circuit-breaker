import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_PORT } from './config/constants.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(APP_PORT);
}
await bootstrap();
