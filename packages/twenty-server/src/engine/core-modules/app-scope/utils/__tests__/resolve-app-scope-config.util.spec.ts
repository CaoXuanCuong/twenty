import { FieldMetadataType, RelationType } from 'twenty-shared/types';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { resolveAppScopeConfig } from 'src/engine/core-modules/app-scope/utils/resolve-app-scope-config.util';

const makeObject = (id: string, nameSingular: string): FlatObjectMetadata =>
  ({ id, nameSingular }) as unknown as FlatObjectMetadata;

const makeManyToOneRelation = ({
  id,
  name,
  objectMetadataId,
  targetObjectMetadataId,
  joinColumnName,
}: {
  id: string;
  name: string;
  objectMetadataId: string;
  targetObjectMetadataId: string;
  joinColumnName: string;
}): FlatFieldMetadata =>
  ({
    id,
    name,
    objectMetadataId,
    type: FieldMetadataType.RELATION,
    relationTargetObjectMetadataId: targetObjectMetadataId,
    settings: { relationType: RelationType.MANY_TO_ONE, joinColumnName },
  }) as unknown as FlatFieldMetadata;

const makeTextField = ({
  id,
  name,
  objectMetadataId,
}: {
  id: string;
  name: string;
  objectMetadataId: string;
}): FlatFieldMetadata =>
  ({
    id,
    name,
    objectMetadataId,
    type: FieldMetadataType.TEXT,
    settings: null,
  }) as unknown as FlatFieldMetadata;

const toMaps = <T extends { id: string }>(items: T[]): FlatEntityMaps<T> =>
  ({
    byUniversalIdentifier: Object.fromEntries(
      items.map((item) => [item.id, item]),
    ),
    universalIdentifierById: {},
    universalIdentifiersByApplicationId: {},
  }) as unknown as FlatEntityMaps<T>;

describe('resolveAppScopeConfig', () => {
  const APP_ID = 'app-object-id';
  const APP_ACCESS_ID = 'app-access-object-id';
  const WORKSPACE_MEMBER_ID = 'workspace-member-object-id';
  const WIDGET_ID = 'widget-object-id';
  const GLOBAL_ID = 'global-object-id';

  it('returns null when there is no app object', () => {
    const result = resolveAppScopeConfig({
      flatObjectMetadataMaps: toMaps([makeObject(GLOBAL_ID, 'widget')]),
      flatFieldMetadataMaps: toMaps<FlatFieldMetadata>([]),
    });

    expect(result).toBeNull();
  });

  it('detects scoped objects and resolves the app access junction', () => {
    const objects = [
      makeObject(APP_ID, 'app'),
      makeObject(APP_ACCESS_ID, 'appAccess'),
      makeObject(WORKSPACE_MEMBER_ID, 'workspaceMember'),
      makeObject(WIDGET_ID, 'widget'),
      makeObject(GLOBAL_ID, 'note'),
    ];

    const fields = [
      // widget -> app (scoped)
      makeManyToOneRelation({
        id: 'f-widget-app',
        name: 'app',
        objectMetadataId: WIDGET_ID,
        targetObjectMetadataId: APP_ID,
        joinColumnName: 'appId',
      }),
      // appAccess -> app
      makeManyToOneRelation({
        id: 'f-access-app',
        name: 'app',
        objectMetadataId: APP_ACCESS_ID,
        targetObjectMetadataId: APP_ID,
        joinColumnName: 'appId',
      }),
      // appAccess -> workspaceMember
      makeManyToOneRelation({
        id: 'f-access-member',
        name: 'member',
        objectMetadataId: APP_ACCESS_ID,
        targetObjectMetadataId: WORKSPACE_MEMBER_ID,
        joinColumnName: 'memberId',
      }),
      // note has no relation to app -> global
      makeTextField({
        id: 'f-note-body',
        name: 'body',
        objectMetadataId: GLOBAL_ID,
      }),
    ];

    const result = resolveAppScopeConfig({
      flatObjectMetadataMaps: toMaps(objects),
      flatFieldMetadataMaps: toMaps(fields),
    });

    expect(result).not.toBeNull();
    expect(result?.appObjectMetadataId).toBe(APP_ID);

    // widget is scoped, junction + app object are not
    expect(result?.scopedObjects[WIDGET_ID]).toEqual({
      appRelationFieldName: 'app',
      appJoinColumnName: 'appId',
    });
    expect(result?.scopedObjects[APP_ACCESS_ID]).toBeUndefined();
    expect(result?.scopedObjects[APP_ID]).toBeUndefined();
    expect(result?.scopedObjects[GLOBAL_ID]).toBeUndefined();

    expect(result?.appAccess).toEqual({
      objectMetadataId: APP_ACCESS_ID,
      appJoinColumnName: 'appId',
      memberJoinColumnName: 'memberId',
    });
  });

  it('leaves appAccess null when the junction is absent', () => {
    const objects = [makeObject(APP_ID, 'app'), makeObject(WIDGET_ID, 'widget')];
    const fields = [
      makeManyToOneRelation({
        id: 'f-widget-app',
        name: 'app',
        objectMetadataId: WIDGET_ID,
        targetObjectMetadataId: APP_ID,
        joinColumnName: 'appId',
      }),
    ];

    const result = resolveAppScopeConfig({
      flatObjectMetadataMaps: toMaps(objects),
      flatFieldMetadataMaps: toMaps(fields),
    });

    expect(result?.appAccess).toBeNull();
    expect(result?.scopedObjects[WIDGET_ID]?.appJoinColumnName).toBe('appId');
  });
});
