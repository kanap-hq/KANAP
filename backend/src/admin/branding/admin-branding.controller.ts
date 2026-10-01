import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EntityManager } from 'typeorm';
import * as path from 'path';
import { IsBoolean, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequireLevel } from '../../auth/require-level.decorator';
import { TenantsService } from '../../tenants/tenants.service';
import { Tenant, TenantBranding } from '../../tenants/tenant.entity';
import { StorageService } from '../../common/storage/storage.service';
import { fixMulterFilename, inlineImageMulterOptions } from '../../common/upload';
import { validateUploadedFile } from '../../common/upload-validation';

class UpdateBrandingSettingsDto {
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primary_color_light?: string | null;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primary_color_dark?: string | null;

  @IsOptional()
  @IsBoolean()
  use_logo_in_dark?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/branding')
export class AdminBrandingController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly storage: StorageService,
  ) {}

  @Get('settings')
  @RequireLevel('users', 'admin')
  async getSettings(@Req() req: any) {
    const tenant = await this.getTenantFromRequest(req, req?.queryRunner?.manager);
    const branding = this.normalizeBranding(tenant.branding);
    return {
      has_logo: !!branding.logo_storage_path,
      logo_version: branding.logo_version,
      use_logo_in_dark: branding.use_logo_in_dark,
      primary_color_light: branding.primary_color_light ?? null,
      primary_color_dark: branding.primary_color_dark ?? null,
    };
  }

  @Post('logo')
  @RequireLevel('users', 'admin')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const manager = req?.queryRunner?.manager;
    const tenant = await this.getTenantFromRequest(req, manager);
    if (!file) throw new BadRequestException('No file uploaded');

    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf,
      size: file.size,
    }, { scope: 'inline-image' });

    const key = path.posix.join('files', tenant.id, 'branding', `logo${validated.extension || '.png'}`);
    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const branding = this.normalizeBranding(tenant.branding);
    const oldPath = branding.logo_storage_path;
    if (oldPath && oldPath !== key) {
      try {
        await this.storage.deleteObject(oldPath);
      } catch {
        // Ignore storage cleanup failures to avoid blocking new uploads.
      }
    }

    // Merged after the storage calls, from the stored branding: a colour saved
    // meanwhile is kept.
    const stored = this.normalizeBranding(
      await this.tenants.mergeBranding(tenant.id, { set: { logo_storage_path: key }, bumpLogoVersion: true }, { manager }),
    );

    return {
      ok: true,
      has_logo: true,
      logo_version: stored.logo_version,
      use_logo_in_dark: stored.use_logo_in_dark,
    };
  }

  @Delete('logo')
  @RequireLevel('users', 'admin')
  async deleteLogo(@Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const tenant = await this.getTenantFromRequest(req, manager);
    const branding = this.normalizeBranding(tenant.branding);

    if (branding.logo_storage_path) {
      try {
        await this.storage.deleteObject(branding.logo_storage_path);
      } catch {
        // Ignore delete failures to keep endpoint idempotent.
      }
    }

    const stored = this.normalizeBranding(
      await this.tenants.mergeBranding(tenant.id, { unset: ['logo_storage_path'], bumpLogoVersion: true }, { manager }),
    );

    return {
      ok: true,
      has_logo: false,
      logo_version: stored.logo_version,
      use_logo_in_dark: stored.use_logo_in_dark,
    };
  }

  @Patch('settings')
  @RequireLevel('users', 'admin')
  async updateSettings(@Body() body: UpdateBrandingSettingsDto, @Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const tenant = await this.getTenantFromRequest(req, manager);
    // Only the keys sent are written.
    const set: Partial<TenantBranding> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'primary_color_light')) {
      set.primary_color_light = this.normalizeHexOrNull(body.primary_color_light);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'primary_color_dark')) {
      set.primary_color_dark = this.normalizeHexOrNull(body.primary_color_dark);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'use_logo_in_dark')) {
      set.use_logo_in_dark = body.use_logo_in_dark !== false;
    }

    const branding = this.normalizeBranding(await this.tenants.mergeBranding(tenant.id, { set }, { manager }));

    return {
      ok: true,
      has_logo: !!branding.logo_storage_path,
      logo_version: branding.logo_version,
      use_logo_in_dark: branding.use_logo_in_dark,
      primary_color_light: branding.primary_color_light ?? null,
      primary_color_dark: branding.primary_color_dark ?? null,
    };
  }

  @Post('reset')
  @RequireLevel('users', 'admin')
  async reset(@Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const tenant = await this.getTenantFromRequest(req, manager);
    const branding = this.normalizeBranding(tenant.branding);

    if (branding.logo_storage_path) {
      try {
        await this.storage.deleteObject(branding.logo_storage_path);
      } catch {
        // Ignore delete failures to keep reset resilient.
      }
    }

    const stored = this.normalizeBranding(
      await this.tenants.mergeBranding(
        tenant.id,
        {
          unset: ['logo_storage_path'],
          set: { use_logo_in_dark: true, primary_color_light: null, primary_color_dark: null },
          bumpLogoVersion: true,
        },
        { manager },
      ),
    );

    return {
      ok: true,
      has_logo: false,
      logo_version: stored.logo_version,
      use_logo_in_dark: true,
      primary_color_light: null,
      primary_color_dark: null,
    };
  }

  private async getTenantFromRequest(req: any, manager?: EntityManager): Promise<Tenant> {
    if (req?.isPlatformHost) {
      throw new ForbiddenException('Branding is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }
    const tenant = await this.tenants.findById(tenantMeta.id, { manager });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  private normalizeBranding(raw: TenantBranding | Record<string, any> | null | undefined): TenantBranding {
    const source = raw && typeof raw === 'object' ? { ...(raw as Record<string, any>) } : {};
    const logoVersion = Number(source.logo_version);

    return {
      logo_storage_path: typeof source.logo_storage_path === 'string' ? source.logo_storage_path : undefined,
      logo_version: Number.isFinite(logoVersion) && logoVersion >= 0 ? logoVersion : 0,
      use_logo_in_dark: source.use_logo_in_dark !== false,
      primary_color_light: this.normalizeHexOrNull(source.primary_color_light),
      primary_color_dark: this.normalizeHexOrNull(source.primary_color_dark),
    };
  }

  private normalizeHexOrNull(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(text)) return null;
    return text.toUpperCase();
  }
}
