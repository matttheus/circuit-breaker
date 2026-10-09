import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { DependencyParamDto } from '../dependencies/dto/dependency-param.dto.js';
import { DependencyPayloadDto } from '../dependencies/dto/dependency-payload.dto.js';
import { DependencyErrorFilter } from './dependency-error.filter.js';
import { SyncDependencyGateway } from './sync-dependency.gateway.js';

@Controller('sync')
@UseFilters(DependencyErrorFilter)
export class SyncController {
  constructor(private readonly gateway: SyncDependencyGateway) {}

  @Post(':dependency')
  @HttpCode(200)
  call(
    @Param() { dependency }: DependencyParamDto,
    @Body() payload: DependencyPayloadDto,
  ) {
    return this.gateway.call(dependency, payload);
  }
}
