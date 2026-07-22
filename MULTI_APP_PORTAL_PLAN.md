# Multi-App Ops Portal — Kế hoạch triển khai

Mở rộng Twenty thành cổng vận hành nội bộ quản lý nhiều Shopify app (BLOY, EU, Fraud, MIDA, Heatmap...), gồm 3 khối: **PM (kanban-first)**, **CS Shifts**, và **phân quyền theo app**.

## 0. Nguyên tắc

- **Giữ core tối thiểu**: data model là no-code (custom object tạo trên UI), logic mới nằm trong module riêng, chỉ chạm core ở vài điểm inject cố định.
- **License-clean**: KHÔNG sửa file mang nhãn `/* @license Enterprise */`. Không dùng lại RLS EE. Tự viết util enforcement.
- **Upgrade-friendly**: phần chạm core chỉ là *thêm lời gọi*, không viết lại logic sẵn có, dễ re-apply khi update Twenty.
- **2 trục quyền độc lập, ghép tự động ở tầng ORM**:
  1. **Trục đối tượng** = Role native của Twenty (object-level CRUD + field-level). Cấu hình bằng UI, 0 code.
  2. **Trục app** = App-scope (junction `App Access` + module enforcement). Đây là phần cần code.
  3. Quyền hiệu lực = `role cho phép` ∩ `app-scope cho phép`.

---

## 1. Data model (no-code, tạo trên UI Twenty)

| Object | Loại | Field chính | Ghi chú |
|---|---|---|---|
| `Apps` | đã có | name, type, ... | Dimension phân quyền. Mỗi record = 1 app |
| `App Access` | **tạo mới (junction)** | `member` → WorkspaceMember (MANY_TO_ONE), `app` → Apps (MANY_TO_ONE), `level` SELECT viewer/editor (để dành v2) | Mỗi record = 1 cấp quyền (member, app) |
| Object vận hành | thêm relation | `app` → Apps (MANY_TO_ONE, **bắt buộc**) | Có relation tới Apps thì tự động bị scope |

**Object cần gắn relation `app` (đã chốt):**
Merchants, Vip Logs, Discounts, Fraud Features, Release Notifications, Features.
Giả định: mỗi Merchant thuộc đúng 1 app (nếu 1 merchant dùng nhiều app → revisit). Tasks/Opportunities CRM: global (v1).

**Convention đặt tên (để module tự nhận diện):**
- Apps object: `nameSingular = app`
- Junction: `nameSingular = appAccess`, field `member` / `app` / `level`
- Field app trên object vận hành: `app`

**Bảo mật data model:**
- `App Access` phải khóa quyền ghi (chỉ Admin/Manager được tạo/sửa) bằng Role native → chống member tự cấp quyền.
- `App` (dimension) member thường chỉ nên Read.

---

## 2. Phân quyền theo đối tượng — Role native (config, 0 code)

Cấu hình ở **Cài đặt → Roles**. Ràng buộc: **1 member = 1 role**.

Bộ role (đã chốt):

| Role | Object được truy cập | Read/Write | App-scope | Bypass app |
|---|---|---|---|---|
| Admin | tất cả | full | — | ✅ |
| Manager | tất cả | full | — | ✅ |
| Dev | Features, Fraud Features, Release Notifications | read+write | ✅ | ❌ |
| PM | Projects, Tasks | read+write | ✅ | ❌ |
| CS Agent | Tickets, Vip Logs, Merchants(read) | read+write | ✅ | ❌ |

- **Bypass app** = thấy mọi app (skip app-scope). v1: quyết theo danh sách role name cấu hình trong module (mặc định Admin, Manager).
- Field-level (ẩn/khóa field theo role) dùng khi cần, cấu hình UI.

---

## 3. App-scope enforcement (phần cần code)

### 3.1 Module mới (code của mình — KHÔNG phải core)

`packages/twenty-server/src/engine/core-modules/app-scope/`
- `app-scope.module.ts`
- `services/app-access-cache.service.ts` — đọc `App Access` (bypass) + metadata → dựng:
  - `appAccessByWorkspaceMember: Record<memberId, appId[]>`
  - `appScopeConfig`: `appObjectId`, `appAccessObjectId`, và `scopedObjects: { objectId, appJoinFieldName }[]` (auto-detect object có relation tới Apps).
  - Cache theo workspace, versioned, invalidate khi `App Access` / metadata đổi. Mirror pattern `metadata-modules/flat-row-level-permission-predicate/services/workspace-flat-row-level-permission-predicate-map-cache.service.ts`.
- `utils/apply-app-scope-filter.util.ts` — dựng `RecordGqlOperationFilter` `{ app: { id: { in: appIds } } }` và áp bằng `GraphqlQueryFilterFieldParser` (parser core, không phải EE). Với chính object `Apps`: filter `{ id: { in: appIds } }`. Bỏ qua `App Access` + object không scoped + member bypass.
- `utils/resolve-app-scope-metadata.util.ts` — resolve theo convention + auto-detect scoped objects.

### 3.2 Điểm chạm core (đã verify — chỉ thêm lời gọi)

| File core | Thay đổi |
|---|---|
| `twenty-orm/interfaces/workspace-internal-context.interface.ts` | thêm field `appAccessByWorkspaceMember` + `appScopeConfig` |
| `twenty-orm/storage/orm-workspace-context.storage.ts` | populate 2 field trên khi build context |
| `twenty-orm/repository/workspace-select-query-builder.ts` | trong `validatePermissions()`: gọi `applyAppScopeFilter` (guard `shouldBypassPermissionChecks`) |
| `twenty-orm/repository/workspace-update-query-builder.ts` | gọi `applyAppScopeFilter` cạnh RLS |
| `twenty-orm/repository/workspace-delete-query-builder.ts` | như trên |
| `twenty-orm/repository/workspace-soft-delete-query-builder.ts` | như trên |
| `twenty-orm/repository/workspace-insert-query-builder.ts` | **write guard**: chặn insert record với `appId` ngoài quyền |
| `api/graphql/graphql-query-runner/group-by/services/group-by-with-records.service.ts` | áp app-scope filter cho group-by/aggregate |

> Không đụng `twenty-orm/utils/apply-row-level-permission-predicates.util.ts` (file EE).

### 3.2b Wiring chi tiết (đã trace trong code)

- **Context 2 tầng**: `ORMWorkspaceContext` (AsyncLocalStorage, `twenty-orm/storage/orm-workspace-context.storage.ts`) được lắp trong `global-workspace-orm.manager.ts` → `loadWorkspaceContext()` (async, mỗi request, pull map từ `WorkspaceCacheService.getOrRecompute`). Query builder đọc `WorkspaceInternalContext` (map từ `workspace-entity-manager.ts`).
- **Nạp app-access**: trong `loadWorkspaceContext()`, dùng `authContext.workspaceMember.id` đọc bảng `appAccess` (BYPASS, tránh tự lọc) → `Set<appId>`; đưa vào context. v1 query mỗi request (1 query indexed); tối ưu cache Redis + invalidate theo event sau.
- **`appScopeConfig`** (Apps object id, AppAccess object id, scopedObjects + appJoinField): tính từ `flatObjectMetadataMaps` (đã có sẵn trong context) — không cần cache riêng.
- **Thêm field vào**: `ORMWorkspaceContext` (storage) + `WorkspaceInternalContext` (interface) + map ở `workspace-entity-manager.ts`.
- **Non-user context** (API key / application): v1 **bypass** app-scope.
- **Filter**: dựng `RecordGqlOperationFilter` `{ <appField>: { id: { in: appIds } } }`, áp qua `GraphqlQueryFilterFieldParser` (core) trong `applyAppScopeFilter()` — thêm vào `validatePermissions()` cạnh `applyRowLevelPermissionPredicates()`.

### 3.3 Chính sách biên
- **Record NULL app**: yêu cầu field `app` bắt buộc trên object scoped → tránh NULL. (Fallback nếu có NULL: chỉ bypass user thấy.)
- **Bypass**: member có role trong danh sách bypass → skip toàn bộ filter.
- **Enforcement đọc `App Access` bằng bypass** để không tự lọc chính nó.
- **Write guard**: insert/update không cho gán `app` ngoài tập quyền của member (nếu bật `level`: write chỉ cho app `level=editor`).

---

## 4. PM module (kanban-first)

- Objects (no-code): `Project` (name, status SELECT, app→Apps), `Task`/`Issue` (name, status SELECT, assignee→WorkspaceMember, project→Project, app→Apps).
- View KANBAN group theo `status` (native, chỉ cần set `mainGroupByFieldMetadataId`).
- Auto được app-scope vì có relation `app`.
- Tùy chọn: front-component cho UX board nâng cao (không fork front, nhúng qua page-layout widget).

---

## 5. CS Shifts module

- Object (no-code): `Shift` (agent→WorkspaceMember, app→Apps, startAt/endAt DATE_TIME, type/status SELECT).
- **v1**: dùng CALENDAR + list view native (0 frontend).
- **v2 (tùy chọn)**: roster grid custom (agent × ngày, coverage, drag-drop) bằng front-component + nav item → page layout. Hạng mục tốn công nhất, làm sau.

---

## 6. Testing (chống rò — làm kỹ)

Integration test phủ **mọi đường data** để chứng minh không lọt:
- select / findMany / findOne
- update / delete / soft-delete / restore
- group-by / aggregate
- **relation traversal** (đọc object scoped qua relation từ object khác)
- write guard (insert/update sai app phải bị chặn)
- bypass user thấy đủ; member thấy đúng tập app; đổi `App Access` → cache cập nhật

Chạy: `npx nx run twenty-server:test:integration:with-db-reset`.

---

## 7. Lộ trình (phases)

- [ ] **Phase 0** — Dev env (`bash packages/twenty-utils/setup-dev-env.sh`) + chốt các quyết định mở ở mục 9.
- [ ] **Phase 1** — Data model: tạo `App Access`, thêm relation `app` vào object vận hành (tôi tạo qua GraphQL hoặc bạn tạo UI).
- [ ] **Phase 2** — Cấu hình bộ Role (trục đối tượng) + khóa ghi `App Access`.
- [ ] **Phase 3** — Module `app-scope` (cache + util) + inject core + write guard.
- [ ] **Phase 4** — Integration test phủ mọi path.
- [ ] **Phase 5** — PM objects + kanban view.
- [ ] **Phase 6** — CS Shifts objects + calendar view.
- [ ] **Phase 7** — Admin UX cấp quyền + (tùy chọn) roster grid front-component.

Phase 1-4 = lõi phân quyền chạy end-to-end. Phase 5-7 độc lập, làm sau.

---

## 8. Rủi ro

- **Re-apply patch core khi update Twenty**: giảm thiểu bằng cách chỉ thêm lời gọi + tập trung logic trong module riêng. Có test hồi quy.
- **Coverage rò**: rủi ro cố hữu của RLS tự viết → bù bằng bộ integration test ở mục 6, bám đúng danh sách điểm inject mà core dùng cho RLS.
- **Convention đặt tên**: nếu đổi tên object sai convention, enforcement no-op. Cân nhắc thêm config pointer ở v2.

---

## 9. Quyết định đã chốt (2026-07-22)

1. Object scope: Merchants, Vip Logs, Discounts, Fraud Features, Release Notifications, Features.
2. Bộ role: Admin, Manager (bypass) / Dev / PM / CS Agent — theo bảng mục 2.
3. Tôi tạo custom object qua GraphQL (không dùng UI thủ công).
4. `level` viewer/editor: để **v2**; v1 binary access.
5. Bypass: theo danh sách role name (Admin, Manager).

**Còn cần xác nhận môi trường (xem trao đổi):** target instance để áp data model (workspace MIDA thật vs local dev) + cách cấp credential.
