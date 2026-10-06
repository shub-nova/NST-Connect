import { Module } from '@nestjs/common';
import { PocController } from './poc.controller';
import { PocService } from './poc.service';

@Module({
  controllers: [PocController],
  providers: [PocService],
})
export class PocModule {}
