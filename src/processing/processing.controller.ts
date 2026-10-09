import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DependencyParamDto } from '../dependencies/dto/dependency-param.dto.js';
import { EnqueueJobsDto } from './dto/enqueue-jobs.dto.js';
import { ProcessingService } from './processing.service.js';

@Controller('jobs')
export class ProcessingController {
  constructor(private readonly processing: ProcessingService) {}

  @Post(':dependency')
  @HttpCode(202)
  enqueue(
    @Param() { dependency }: DependencyParamDto,
    @Body() { count }: EnqueueJobsDto,
  ) {
    return this.processing.enqueue(dependency, count);
  }

  @Get('counts')
  counts() {
    return this.processing.counts();
  }
}
