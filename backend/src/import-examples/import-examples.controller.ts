import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { languageOf } from '../common/csv-sheet';
import { contentDisposition } from '../common/content-disposition';
import { ImportExampleKey } from './import-example-definitions';
import { ImportExamplesService } from './import-examples.service';

/**
 * The example file of an import, offered next to its template in the import dialog. Each route asks
 * the level of the import it illustrates. The file holds sample rows and the workspace's catalogs, no
 * record of the workspace: it is not an export.
 */
@UseGuards(JwtAuthGuard)
@Controller('import-examples')
export class ImportExamplesController {
  constructor(private readonly svc: ImportExamplesService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Get('applications')
  applications(@Query('language') language: string | undefined, @Req() req: any, @Res() res: Response) {
    return this.send('applications', language, req, res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Get('assets')
  assets(@Query('language') language: string | undefined, @Req() req: any, @Res() res: Response) {
    return this.send('assets', language, req, res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'admin')
  @Get('portfolio-projects')
  projects(@Query('language') language: string | undefined, @Req() req: any, @Res() res: Response) {
    return this.send('portfolio-projects', language, req, res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'admin')
  @Get('suppliers')
  suppliers(@Query('language') language: string | undefined, @Req() req: any, @Res() res: Response) {
    return this.send('suppliers', language, req, res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Get('contracts')
  contracts(@Query('language') language: string | undefined, @Req() req: any, @Res() res: Response) {
    return this.send('contracts', language, req, res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @Get('budget-lines')
  budgetLines(@Query('language') language: string | undefined, @Req() req: any, @Res() res: Response) {
    return this.send('budget-lines', language, req, res);
  }

  private async send(key: ImportExampleKey, languageRaw: string | undefined, req: any, res: Response) {
    const manager = req?.queryRunner?.manager;
    const tenantId = req.tenant.id;
    const language = await languageOf(manager, tenantId, req.user?.sub ?? null, languageRaw);
    const file = await this.svc.build(key, language, { manager, tenantId });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    res.send(file.content);
  }
}
