import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import { CircuitNameParamDto } from './dto/circuit-name-param.dto.js';

@Controller('circuit-breakers')
export class CircuitBreakerController {
  constructor(private readonly circuitBreakers: CircuitBreakerService) {}

  @Get()
  list() {
    return this.circuitBreakers.list();
  }

  @Get(':name')
  get(@Param() { name }: CircuitNameParamDto) {
    return this.circuitBreakers.get(name);
  }

  @Post(':name/reset')
  @HttpCode(200)
  reset(@Param() { name }: CircuitNameParamDto) {
    return this.circuitBreakers.reset(name);
  }
}
