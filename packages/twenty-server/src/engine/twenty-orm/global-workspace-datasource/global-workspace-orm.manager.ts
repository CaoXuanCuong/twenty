import { Injectable, type Type } from '@nestjs/common';

import { type ObjectLiteral } from 'typeorm';

import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { ExecuteInWorkspaceContextOptions } from 'src/engine/twenty-orm/global-workspace-datasource/types/execute-in-workspace-context-options.type';
import type { WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import {
  type ORMWorkspaceContext,
  withWorkspaceContext,
} from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import type { RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { convertClassNameToObjectMetadataName } from 'src/engine/workspace-manager/utils/convert-class-to-object-metadata-name.util';
import { isDefined } from 'twenty-shared/utils';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR } from 'src/engine/core-modules/app-scope/constants/app-scope.constants';
import { type AppScopeConfig } from 'src/engine/core-modules/app-scope/types/app-scope-config.type';
import { resolveAppScopeConfig } from 'src/engine/core-modules/app-scope/utils/resolve-app-scope-config.util';

@Injectable()
export class GlobalWorkspaceOrmManager {
  constructor(
    private readonly globalWorkspaceDataSourceService: GlobalWorkspaceDataSourceService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    workspaceEntity: Type<T>,
    permissionOptions?: RolePermissionConfig,
  ): Promise<WorkspaceRepository<T>>;

  async getRepository<T extends ObjectLiteral>(
    workspaceId: string,
    objectMetadataName: string,
    permissionOptions?: RolePermissionConfig,
  ): Promise<WorkspaceRepository<T>>;

  async getRepository<T extends ObjectLiteral>(
    _workspaceId: string,
    workspaceEntityOrObjectMetadataName: Type<T> | string,
    permissionOptions?: RolePermissionConfig,
  ): Promise<WorkspaceRepository<T>> {
    let objectMetadataName: string;

    if (typeof workspaceEntityOrObjectMetadataName === 'string') {
      objectMetadataName = workspaceEntityOrObjectMetadataName;
    } else {
      objectMetadataName = convertClassNameToObjectMetadataName(
        workspaceEntityOrObjectMetadataName.name,
      );
    }

    const globalDataSource = await this.getGlobalWorkspaceDataSource();

    return globalDataSource.getRepository<T>(
      objectMetadataName,
      permissionOptions,
    );
  }

  async getGlobalWorkspaceDataSource(): Promise<GlobalWorkspaceDataSource> {
    return this.globalWorkspaceDataSourceService.getGlobalWorkspaceDataSource();
  }

  async getGlobalWorkspaceDataSourceReplica(): Promise<GlobalWorkspaceDataSource> {
    return this.globalWorkspaceDataSourceService.getGlobalWorkspaceDataSourceReplica();
  }

  async executeInWorkspaceContext<T>(
    fn: () => T | Promise<T>,
    authContext?: WorkspaceAuthContext,
    options?: ExecuteInWorkspaceContextOptions,
  ): Promise<T> {
    const resolvedAuthContext = authContext ?? getWorkspaceAuthContext();
    const context = options?.lite
      ? await this.loadLiteWorkspaceContext(resolvedAuthContext)
      : await this.loadWorkspaceContext(resolvedAuthContext);

    return withWorkspaceContext(context, fn);
  }

  private async loadWorkspaceContext(
    authContext: WorkspaceAuthContext,
  ): Promise<ORMWorkspaceContext> {
    const workspaceId = authContext.workspace.id;

    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps,
      featureFlagsMap,
      rolesPermissions: permissionsPerRoleId,
      ORMEntityMetadatas: entityMetadatas,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
      flatRowLevelPermissionPredicateMaps,
      flatRowLevelPermissionPredicateGroupMaps,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'flatIndexMaps',
      'featureFlagsMap',
      'rolesPermissions',
      'ORMEntityMetadatas',
      'userWorkspaceRoleMap',
      'apiKeyRoleMap',
      'flatRowLevelPermissionPredicateMaps',
      'flatRowLevelPermissionPredicateGroupMaps',
    ]);

    const { idByNameSingular: objectIdByNameSingular } =
      buildObjectIdByNameMaps(flatObjectMetadataMaps);

    const appScopeConfig = resolveAppScopeConfig({
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
    });

    const baseContext: ORMWorkspaceContext = {
      authContext,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps,
      flatRowLevelPermissionPredicateMaps,
      flatRowLevelPermissionPredicateGroupMaps,
      objectIdByNameSingular,
      featureFlagsMap,
      permissionsPerRoleId,
      entityMetadatas,
      userWorkspaceRoleMap,
      apiKeyRoleMap,
      appScopeConfig,
      appScopeAccessibleAppIds: null,
    };

    const appScopeAccessibleAppIds = await this.loadAppScopeAccessibleAppIds({
      workspaceId,
      authContext,
      appScopeConfig,
      baseContext,
    });

    return { ...baseContext, appScopeAccessibleAppIds };
  }

  // Loads the set of app ids the caller may access. null = bypass (no model,
  // no grant junction, or non-user context). The grant records are read with
  // permission checks bypassed so this lookup never filters itself.
  private async loadAppScopeAccessibleAppIds({
    workspaceId,
    authContext,
    appScopeConfig,
    baseContext,
  }: {
    workspaceId: string;
    authContext: WorkspaceAuthContext;
    appScopeConfig: AppScopeConfig | null;
    baseContext: ORMWorkspaceContext;
  }): Promise<string[] | null> {
    if (!isDefined(appScopeConfig) || !isDefined(appScopeConfig.appAccess)) {
      return null;
    }

    if (!isUserAuthContext(authContext)) {
      return null;
    }

    const workspaceMemberId = authContext.workspaceMember?.id;

    if (!isDefined(workspaceMemberId)) {
      return null;
    }

    const { appAccess } = appScopeConfig;

    const rows = await withWorkspaceContext(baseContext, async () => {
      const repository = await this.getRepository(
        workspaceId,
        APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR,
        { shouldBypassPermissionChecks: true },
      );

      return repository
        .createQueryBuilder(APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR)
        .select(
          `${APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR}.${appAccess.appJoinColumnName}`,
          'appId',
        )
        .where(
          `${APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR}.${appAccess.memberJoinColumnName} = :workspaceMemberId`,
          { workspaceMemberId },
        )
        .getRawMany<{ appId: string | null }>();
    });

    return rows.map((row) => row.appId).filter(isDefined);
  }

  private async loadLiteWorkspaceContext(
    authContext: WorkspaceAuthContext,
  ): Promise<ORMWorkspaceContext> {
    const workspaceId = authContext.workspace.id;

    const {
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      ORMEntityMetadatas: entityMetadatas,
    } = await this.workspaceCacheService.getOrRecompute(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
      'ORMEntityMetadatas',
    ]);

    const { idByNameSingular: objectIdByNameSingular } =
      buildObjectIdByNameMaps(flatObjectMetadataMaps);

    return {
      authContext,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      flatIndexMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatRowLevelPermissionPredicateMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatRowLevelPermissionPredicateGroupMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      objectIdByNameSingular,
      featureFlagsMap: {} as ORMWorkspaceContext['featureFlagsMap'],
      permissionsPerRoleId: {},
      entityMetadatas,
      userWorkspaceRoleMap: {},
      apiKeyRoleMap: {},
    };
  }
}
