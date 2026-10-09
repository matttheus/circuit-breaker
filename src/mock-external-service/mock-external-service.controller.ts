import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { DependencyParamDto } from '../dependencies/dto/dependency-param.dto.js';
import { DependencyPayloadDto } from '../dependencies/dto/dependency-payload.dto.js';
import { MockBehaviorDto } from './dto/mock-behavior.dto.js';
import { MockExternalService } from './mock-external-service.service.js';

@Controller('mock')
export class MockExternalServiceController {
  constructor(private readonly mock: MockExternalService) {}

  @Get('stats')
  getStats() {
    return this.mock.getStats();
  }

  @Put(':dependency/behavior')
  setBehavior(
    @Param() { dependency }: DependencyParamDto,
    @Body() behavior: MockBehaviorDto,
  ) {
    return this.mock.setBehavior(dependency, behavior);
  }

  @Post(':dependency/reset')
  @HttpCode(200)
  reset(@Param() { dependency }: DependencyParamDto) {
    return this.mock.reset(dependency);
  }

  @Get(':dependency/health')
  health(@Param() { dependency }: DependencyParamDto) {
    return this.mock.health(dependency);
  }

  @Post(':dependency')
  @HttpCode(200)
  handle(
    @Param() { dependency }: DependencyParamDto,
    @Body() payload: DependencyPayloadDto,
  ) {
    return this.mock.handle(dependency, payload);
  }
}
