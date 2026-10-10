import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferenceCheckService } from './reference-check.service';
import { ItemNumberService } from './item-number.service';
import { SpendItem } from '../spend/spend-item.entity';
import { DocumentExportService } from './document-export.service';
import { RemoteInlineImageImportService } from './remote-inline-image-import.service';
import { DocumentImportService } from './document-import.service';
import { VectorImageConversionService } from './vector-image-conversion.service';

@Module({
  imports: [TypeOrmModule.forFeature([SpendItem])],
  providers: [
    ReferenceCheckService,
    ItemNumberService,
    DocumentExportService,
    RemoteInlineImageImportService,
    DocumentImportService,
    VectorImageConversionService,
  ],
  exports: [
    ReferenceCheckService,
    ItemNumberService,
    DocumentExportService,
    RemoteInlineImageImportService,
    DocumentImportService,
    VectorImageConversionService,
  ],
})
export class CommonModule {}
